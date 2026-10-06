---
title: Refだけでは足りない？OPAでCloudFormationの未確定値を事前検査する
emoji: 🔍
type: tech
topics: 
  - aws
  - cloudformation
  - opa
  - security
  - cicd
published: false
date: "2026-10-06"
---


## はじめに

[前回の記事](https://zenn.dev/takuyousou/articles/aws-opa-cloudformation-policy-as-code)では、OPAとConftestを利用してCloudFormationテンプレートを静的に検査し、Public SSH/RDPをデプロイ前に検出しました。

前回のPoCでは、ポート番号とCIDRをテンプレートへ直接記述していました。しかし、実際のCloudFormationでは、次のように値がデプロイ時に決まることがあります。

```yaml
FromPort: !If [UseManagementPort, !Ref ManagementPort, 443]
ToPort: !If [UseManagementPort, !Ref ManagementPort, 443]
CidrIp: !Sub "${NetworkAddress}/${PrefixLength}"
```

この状態でテンプレートだけをConftestへ渡しても、最終的なポート番号やCIDRを判断できません。

そこで本記事では、CloudFormationの値がどこで決まるかに応じて、検査方法を次の3つに分けます。

- CI内で決定できる`!Ref`、`Fn::If`、一般的な`Fn::Sub`は、値を解決してからOPAで検査する
- SSM Parameter StoreやSecrets Managerの動的参照は、無理に展開せず未解決として停止する
- MacroやTransformは独自実装せず、CloudFormationが処理したテンプレートを検査する

今回のローカル検証では、次の結果を確認します。

- 本番環境で`ManagementPort=22`を指定するとPublic SSHとして検出できる
- 開発環境では`Fn::If`によって443が選択され、Public HTTPSとして許可できる
- 必須パラメータやセキュリティ関連の値を解決できない場合は処理を停止できる

:::message
本記事の目的は、CloudFormationの評価処理をすべて再実装することではありません。

CI内で安全に決定できる値だけを解決し、外部サービスやCloudFormation側の処理に依存する値は、別の方法で検査します。
:::

## 本記事の対象者

本記事は、次のような方を対象としています。

- OPA/ConftestでCloudFormationを検査している方
- `!Ref`や`Fn::If`を含むテンプレートの検査方法に悩んでいる方
- 環境別パラメータをCI/CDで安全に検査したい方
- 静的検査で値を解決できない場合の扱いを検討している方

## なぜテンプレート単体では判断できないのか

今回使用するテンプレートでは、環境と管理ポートをパラメータとして受け取ります。

```yaml
Parameters:
  Environment:
    Type: String
    AllowedValues:
      - production
      - development

  ManagementPort:
    Type: Number

  NetworkAddress:
    Type: String
    Default: 0.0.0.0

  PrefixLength:
    Type: Number
    Default: 0

Conditions:
  UseManagementPort: !Equals [!Ref Environment, production]
```

Security Groupは次のように定義します。

```yaml
Resources:
  ParameterizedSecurityGroup:
    Type: AWS::EC2::SecurityGroup
    Properties:
      GroupDescription: !Sub "${Environment} ingress for Policy as Code testing"
      SecurityGroupIngress:
        - IpProtocol: tcp
          FromPort: !If [UseManagementPort, !Ref ManagementPort, 443]
          ToPort: !If [UseManagementPort, !Ref ManagementPort, 443]
          CidrIp: !Sub "${NetworkAddress}/${PrefixLength}"
```

同じテンプレートでも、入力によって最終的な設定が変わります。

| 入力 | `Fn::If`の結果 | 最終的な設定 | ポリシー判定 |
| --- | ---: | --- | --- |
| `Environment=production`、`ManagementPort=22` | 22 | Public SSH | FAIL |
| `Environment=production`、`ManagementPort=3389` | 3389 | Public RDP | FAIL |
| `Environment=development`、`ManagementPort=22` | 443 | Public HTTPS | PASS |

つまり、テンプレートだけでなく、実際のデプロイに使用するパラメータも含めて検査する必要があります。

## 値の決まり方によって検査方法を分ける

すべての未確定値を同じ方法で処理するのではなく、値の取得元によって扱いを分けます。

| 記述 | 値の取得元 | 本記事での扱い |
| --- | --- | --- |
| `!Ref` | Parametersの指定値またはDefault | CI内で解決 |
| `Fn::If` | Conditionsの評価結果 | CI内で解決 |
| `Fn::Sub` | Parametersまたは明示的な変数マップ | CI内で解決 |
| 動的参照 | SSM Parameter Store、Secrets Manager | 未解決なら停止 |
| Macro / Transform | CloudFormation、Lambda | CloudFormationで展開後に検査 |
| リソースの`Ref`、`Fn::GetAtt` | 作成されるAWSリソース | 今回のローカル解決対象外 |

重要なのは、値を解決できなかったときに「違反なし」と判断しないことです。特にポート番号やCIDRなどのセキュリティ判定に必要な値が未解決なら、fail closed（安全側に倒す）として処理を停止します。

## 検証の流れ

今回の検証では、AWSリソースを実際に作成しません。次の4つをローカルに用意し、CloudFormationテンプレートをデプロイ前に検査します。

| 構成要素 | 役割 |
| --- | --- |
| CloudFormationテンプレート | `!Ref`、`Fn::If`、`Fn::Sub`を含む検査対象 |
| パラメータファイル | 実際のデプロイを想定した入力値 |
| 前処理スクリプト | テンプレートとパラメータを組み合わせて実効値を決定 |
| Regoポリシー | 解決後のSecurity Groupを検査 |

処理の流れは次のとおりです。

```text
CloudFormationテンプレート
        ＋
デプロイパラメータ
        ↓
Intrinsic Functionsを解決
        ↓
解決後のJSONをConftestで検査
```

OPAポリシーは、前回作成したルールのうち、`AWS::EC2::SecurityGroup`内に記述されたインライン形式のインバウンドルールを検査する部分を利用します。Public SSH/22とPublic RDP/3389を拒否し、Public HTTPS/443は許可します。

本記事ではコード全体ではなく、パラメータ解決の考え方と、OPAへ渡すまでの処理、実行結果を中心に説明します。

:::message
今回ローカルで実際に解決するのは、Parametersを参照する`!Ref`、Conditionsを利用する`Fn::If`、Parametersを利用する`Fn::Sub`です。

動的参照については、セキュリティ判定に必要な値を解決できない場合に処理を停止できることを確認します。MacroやTransformは今回のローカル検証には含めず、実運用での検査方針として後半で説明します。
:::

## デプロイパラメータを用意する

パラメータファイルには、CloudFormation APIでも使用できる`ParameterKey`と`ParameterValue`の形式を使用します。

### Public SSHになる入力

`parameters/unsafe-ssh.json`では、本番環境の管理ポートに22を指定します。

```json
[
  {
    "ParameterKey": "Environment",
    "ParameterValue": "production"
  },
  {
    "ParameterKey": "ManagementPort",
    "ParameterValue": "22"
  }
]
```

`NetworkAddress`と`PrefixLength`は指定していないため、テンプレートのDefaultから`0.0.0.0/0`が作られます。

### Public HTTPSになる入力

`parameters/safe-https.json`では、開発環境を指定します。

```json
[
  {
    "ParameterKey": "Environment",
    "ParameterValue": "development"
  },
  {
    "ParameterKey": "ManagementPort",
    "ParameterValue": "22"
  }
]
```

`ManagementPort`には22を指定していますが、`UseManagementPort`がfalseになるため、`Fn::If`のfalse側にある443が選択されます。

:::message
検査で使用するパラメータと、実際のデプロイで使用するパラメータは同じファイルから取得します。

検査後にコンソールなどから別の値を入力すると、検査した構成と実際にデプロイされる構成が一致しません。
:::

## CI内で値を解決する

前処理スクリプトでは、パラメータ値を次の優先順位で決定します。

```text
パラメータファイルの指定値
        ↓ 指定がない場合
Parameters.Default
        ↓ どちらもない場合
エラーとして停止
```

### `!Ref`を解決する

PyYAMLでCloudFormationの短縮記法を読み取れるようにし、`!Ref ManagementPort`を内部では次の形式として保持します。

```json
{
  "Ref": "ManagementPort"
}
```

`Ref`の参照先がParametersに存在する場合は、パラメータファイルまたはDefaultから取得した実効値へ置き換えます。

一方、Parametersではなくリソースの論理IDを参照する`Ref`は、今回のローカルスクリプトでは置き換えません。

### `Fn::If`を解決する

`Fn::If`を評価するには、先にConditionsの結果を決める必要があります。

今回の`UseManagementPort`は、`Environment`が`production`と一致するかを`Fn::Equals`で判定します。左右の値に含まれる`!Ref`を先に解決してから比較し、条件の結果に応じて`Fn::If`のtrue側またはfalse側を選択します。

検証用スクリプトでは`Fn::Equals`に加え、`Fn::And`、`Fn::Or`、`Fn::Not`も評価できるようにしています。

### `Fn::Sub`を解決する

`Fn::Sub`は、文字列内の変数をParametersまたは明示的な変数マップから取得します。

```yaml
CidrIp: !Sub "${NetworkAddress}/${PrefixLength}"
```

Default値を使用した場合、解決結果は次のようになります。

```yaml
CidrIp: 0.0.0.0/0
```

ただし、`Fn::Sub`では疑似パラメータ、リソースの論理ID、`Fn::GetAtt`も参照できます。今回の検証で解決するのは、Parametersと明示的な変数マップだけです。

今回の検証用スクリプトでは、`Fn::Sub`内に解決対象外の変数が残った場合、使用箇所にかかわらずエラーとして処理を停止します。

## 解決後のテンプレートを確認する

まず、Public SSHになるパラメータを使って変換します。検証用に作成した前処理スクリプトを、次のように実行しました。

```bash
python3 scripts/resolve_parameters.py \
  --template templates/parameterized-security-group.yaml \
  --parameters parameters/unsafe-ssh.json \
  --output build/unsafe.json
```

解決後のSecurity Groupは次のようになります。

```json
{
  "GroupDescription": "production ingress for Policy as Code testing",
  "SecurityGroupIngress": [
    {
      "IpProtocol": "tcp",
      "FromPort": 22,
      "ToPort": 22,
      "CidrIp": "0.0.0.0/0"
    }
  ]
}
```

`!Ref`だけでなく、`Fn::If`と`Fn::Sub`も通常の値へ置き換わったため、OPAは前回と同じRegoポリシーで検査できます。

![Intrinsic Functionsを解決したテンプレート](/images/aws-opa-cloudformation-ref-parameters/resolved-template-ssh.png)

## ローカルで3つのケースを検証する

### 1. 本番環境 + 22：FAIL

解決後のテンプレートをConftestで検査します。

```bash
conftest test build/unsafe.json --policy policy
```

Public SSHが検出され、Conftestはexit code 1を返します。

```text
FAIL - build/unsafe.json - main - ParameterizedSecurityGroup allows SSH (22) from the public internet

2 tests, 1 passed, 0 warnings, 1 failure, 0 exceptions
```

テンプレート上では複数のIntrinsic Functionsが使われていても、最終的な値を事前に決定できれば、既存のOPAポリシーをそのまま再利用できます。

![本番環境でPublic SSHを検出した結果](/images/aws-opa-cloudformation-ref-parameters/unsafe-ssh-failed.png)

### 2. 開発環境 + 22：PASS

次に、開発環境のパラメータを使って変換・検査します。

```bash
python3 scripts/resolve_parameters.py \
  --template templates/parameterized-security-group.yaml \
  --parameters parameters/safe-https.json \
  --output build/safe.json

conftest test build/safe.json --policy policy
```

`ManagementPort`には22を指定していますが、`Fn::If`によって443が選択されます。

```json
{
  "IpProtocol": "tcp",
  "FromPort": 443,
  "ToPort": 443,
  "CidrIp": "0.0.0.0/0"
}
```

443は今回の禁止対象ではないため、検査は成功します。

```text
2 tests, 2 passed, 0 warnings, 0 failures, 0 exceptions
```

![開発環境でPublic HTTPSを許可した結果](/images/aws-opa-cloudformation-ref-parameters/safe-https-passed.png)

### 3. 必須パラメータなし：FAIL

必須パラメータを指定しない空のファイルでも実行します。

```json
[]
```

```bash
python3 scripts/resolve_parameters.py \
  --template templates/parameterized-security-group.yaml \
  --parameters parameters/missing.json \
  --output build/missing.json
```

`Environment`と`ManagementPort`にはDefaultがないため、値を推測せずに処理を停止します。

```text
Template resolution failed: Required parameter is missing: Environment
```
![必須パラメータなしを拒否した結果](/images/aws-opa-cloudformation-ref-parameters/missing-parameter-failed.png)


不明な値を安全な値として扱わないことが、今回の前処理で最も重要な点です。

## ローカルで解決できない値への対応

### 動的参照

実環境では、SSM Parameter StoreやSecrets Managerの値を動的参照することがあります。

```yaml
FromPort: "{{resolve:ssm:/example/management-port}}"
ToPort: "{{resolve:ssm:/example/management-port}}"
```

動的参照は、CloudFormationがスタックまたはChange Setを処理する際に外部サービスから値を取得します。そのため、ローカルファイルだけでは最終値を判断できません。

CIからSSM Parameter Storeを参照する実装も可能ですが、次の点を考慮する必要があります。

- CodeBuildなどの実行ロールにSSMまたはSecrets Managerの権限が必要になる
- AWSアカウントやRegionによって値が異なる
- Secrets Managerの値を中間JSONやBuildログへ出力すると情報漏えいにつながる
- 検査時とデプロイ時の間に値が変更される可能性がある

そのため、今回の検証ではSecurity GroupのポートやCIDRに動的参照が残っている場合、値を展開せずに処理を停止します。

```text
Template resolution failed: Unresolved security value:
DynamicReferenceSecurityGroup.SecurityGroupIngress[0].FromPort
```
![動的参照が未解決の場合に処理を停止した結果](/images/aws-opa-cloudformation-ref-parameters/dynamic-reference-failed.png)

実運用では、対象によって次のように分けるのが現実的です。

| 対象 | 推奨する扱い |
| --- | --- |
| 機密ではないSSMパラメータ | 最小権限で取得して検査することを検討 |
| Secrets Manager、SecureString | 値をログや中間ファイルへ出力しない |
| セキュリティ判定に必要だが取得できない値 | ビルドを停止する |
| セキュリティ判定に不要な値 | 未解決のまま保持する |

「解決できなかったので検査対象外」とするのではなく、ポリシー判断に必要な値かどうかを基準に扱いを決めます。

### MacroやTransform

MacroはLambdaなどを利用して、CloudFormationテンプレートの一部または全体を変換できます。`AWS::Include`や`AWS::Serverless`もTransformの例です。

MacroによってSecurity Groupが追加される場合、変換前のテンプレートだけをOPAで検査しても、そのSecurity Groupは見えません。

独自スクリプトでMacroの処理を再現するのではなく、CloudFormationに変換させた後のテンプレートを検査します。

```text
Original template
       ↓
CloudFormation Change Set
       ↓ Macro / Transform
Processed template
       ↓
Conftest / OPA
```

Change Setの作成完了後は、`GetTemplate`の`TemplateStage=Processed`を使用して、Transform適用後のテンプレートを取得できます。

ただし、`Processed`は「MacroやTransformが適用されたテンプレート」であり、すべての`Ref`、`Fn::GetAtt`、動的参照が最終値になったテンプレートではありません。

また、Macroの実行にはAWS環境とIAM権限が必要です。カスタムMacroではLambdaが呼び出されるため、信頼できるMacroだけを検証用アカウントで実行する必要があります。

## CI/CDへ組み込む場合
本記事では、Intrinsic Functionsの解決とOPAによる検査をローカルで確認しました。

CI/CDへ組み込む場合は、Conftestを実行する前に、今回作成したパラメータ解決処理を追加します。

CodeBuildで追加する主な処理は次の2つです。

```yaml
phases:
  build:
    commands:
      - python3 scripts/resolve_parameters.py --template templates/parameterized-security-group.yaml --parameters "${PARAMETER_FILE}" --output build/resolved-template.json
      - conftest test build/resolved-template.json --policy policy
```

パラメータ解決またはConftestが非ゼロのexit codeを返した場合、後続のデプロイ処理には進みません。

CodeBuildでConftestの違反を検出し、Buildを停止できることは前回の記事で確認しているため、本記事ではローカル検証との差分だけを示しています。

実際にCloudFormationのChange Setを作成するときも同じパラメータファイルを使用し、検査時とデプロイ時の入力値を一致させる必要があります。

## CloudFormation側の制約も利用する

すべてをOPAだけで制御する必要はありません。テンプレート固有の入力制約は、`AllowedValues`や`AllowedPattern`でも定義できます。一方、複数のリポジトリやIaCツールへ共通ルールを適用する場合は、OPAによるポリシー管理と組み合わせる方法が有効です。

## 実運用では複数の検査を組み合わせる

OPAだけですべてを判断するのではなく、各段階の役割を分けます。

| 段階 | 主な役割 |
| --- | --- |
| `cfn-lint` | テンプレートの構文・リソース仕様を検査 |
| 前処理 + OPA / Conftest | CIで決定できる値に対して独自ポリシーを検査 |
| Change Set + Processed template | MacroやTransform適用後の構成を検査 |
| CloudFormation Hooks | リソース作成・更新時に追加制御 |
| AWS Config | デプロイ後や手動変更を継続的に評価 |

早い段階で判断できるリスクはCI/CDで止め、AWS環境に依存する処理はChange SetやHooks、デプロイ後の変更はAWS Configで補完します。

## まとめ

本記事では、CloudFormationの未確定値をすべて同じ方法で扱わず、値の取得元に応じて検査方法を分けました。

- Parametersを参照する`!Ref`を実際のデプロイパラメータで解決した
- Conditionsを評価し、`Fn::If`の有効な分岐を検査した
- Parametersを使う`Fn::Sub`を通常の文字列へ変換した
- 必須パラメータやセキュリティ関連の値を解決できない場合はfail closedにした
- 動的参照は、機密値を安易に展開せず用途に応じて扱いを分けた
- MacroやTransformは、CloudFormationのProcessed templateを検査する方針とした

CloudFormationには多くのIntrinsic Functionsがあり、独自スクリプトですべてを再現するのは現実的ではありません。

重要なのは、対応していない式を黙って無視することではなく、「CI内で決定できる値」「AWS環境で決まる値」「デプロイ後にしか確認できない状態」を区別し、それぞれに適した検査を配置することです。

本記事が、CloudFormationの実際の入力値まで含めたPolicy as Codeを設計する際の参考になれば幸いです。

## 参考資料

- [CloudFormationテンプレートのParameters構文](https://docs.aws.amazon.com/ja_jp/AWSCloudFormation/latest/UserGuide/parameters-section-structure.html)
- [Ref - AWS CloudFormation](https://docs.aws.amazon.com/ja_jp/AWSCloudFormation/latest/TemplateReference/intrinsic-function-reference-ref.html)
- [条件関数 - AWS CloudFormation](https://docs.aws.amazon.com/ja_jp/AWSCloudFormation/latest/TemplateReference/intrinsic-function-reference-conditions.html)
- [Fn::Sub - AWS CloudFormation](https://docs.aws.amazon.com/ja_jp/AWSCloudFormation/latest/TemplateReference/intrinsic-function-reference-sub.html)
- [動的参照を使用して他のサービスに格納されている値を取得する](https://docs.aws.amazon.com/ja_jp/AWSCloudFormation/latest/UserGuide/dynamic-references.html)
- [CloudFormationマクロの概要](https://docs.aws.amazon.com/ja_jp/AWSCloudFormation/latest/UserGuide/template-macros-overview.html)
- [GetTemplate - AWS CloudFormation API Reference](https://docs.aws.amazon.com/ja_jp/AWSCloudFormation/latest/APIReference/API_GetTemplate.html)
- [Open Policy Agent公式ドキュメント（英語）](https://www.openpolicyagent.org/docs/)
- [Conftest公式ドキュメント（英語）](https://www.conftest.dev/)
