---
title: 危険なSecurity Groupをデプロイ前に止める！OPAでCloudFormationを事前検査する
emoji: 🛡️
type: tech
topics: 
  - aws
  - cloudformation
  - opa
  - security
  - cicd
published: false
date: "2026-09-29"
---

## はじめに

AWS環境のセキュリティ設定を継続的に確認する仕組みとして、AWS Configを利用している環境は多いと思います。

一方、Detective evaluation（検出評価）では、基本的にリソースの作成・変更後に設定を評価します。自動修復を組み合わせた場合でも、作成から検出・修復までの間、一時的に危険な設定が存在する可能性があります。

そこで本記事では、Open Policy Agent（OPA）とConftestを利用し、CloudFormationテンプレートをデプロイ前に検査します。検証対象は、インターネット全体からSSHまたはRDPを許可するSecurity Groupです。

今回確認したいのは、次の3点です。

- 危険な設定をAWSへデプロイする前に検出できるか
- 正常なPublic HTTPSまで誤って拒否しないか
- CI/CD上で違反を検出した場合に後続処理を停止できるか

:::message
AWS Configには、未デプロイのリソース設定を評価するProactive evaluationもあります。本記事では、OPAを利用したCI/CD内のPolicy as Codeと、AWS Configの一般的なDetective evaluationの役割の違いを中心に整理します。
:::

## 本記事の対象者

本記事は、次のような方を対象としています。

- CloudFormationを利用してAWSリソースを管理している方
- Security Groupの危険な設定をデプロイ前に検出したい方
- OPAやConftestをCI/CDへ組み込む方法に興味がある方
- AWS Configによるデプロイ後の検出に加えて、事前検査も導入したい方

OPAやRegoを初めて利用する方でも流れを把握できるように、検出ルール、単体テスト、ローカル実行、CodeBuildへの組み込みの順に説明します。

## Policy as Codeとは

Policy as Codeは、セキュリティや運用上のルールをコードとして記述し、自動的に評価する考え方です。

たとえば、次のようなルールを対象にできます。

- Security Groupで管理ポートをインターネットへ公開しない
- S3バケットの暗号化を必須にする
- リソースに必要なタグが設定されていることを確認する
- IAMポリシーで過剰な権限を許可しない

ルールをコードにすることで、バージョン管理、Pull Requestでのレビュー、単体テスト、CI/CDへの組み込みが可能になります。

今回は、OPAのポリシー言語であるRegoでルールを記述し、YAMLやJSONなどの構造化データを検査できるConftestから実行します。

## 今回の検証構成

検証の流れは次のとおりです。

1. CloudFormationテンプレートを作成する
2. `cfn-lint`でテンプレートの構文やリソース仕様を検査する
3. ConftestからRegoポリシーを実行する
4. 違反があればBuildを失敗させる
5. 合格したテンプレートだけを後続のDeployへ進める

```text
CloudFormation template
          ↓
       cfn-lint
          ↓
    Conftest / OPA
      ├─ PASS → Deploy
      └─ FAIL → Stop
```

本検証ではテンプレートを静的に評価するため、Security GroupやEC2を実際に作成する必要はありません。

また、今回のPoCではDeployステージ自体は実行しません。CodeBuildの成功を「後続のDeploy処理へ進める状態」、失敗を「後続処理を停止した状態」として確認します。

## 検出ルールを決める

`0.0.0.0/0`を含むルールをすべて拒否すると、インターネット公開が必要なWebサービスのHTTP/HTTPSまでデプロイできなくなります。

そのため、今回は「Public CIDRかどうか」だけでなく、「どのポートを公開しているか」も組み合わせて判断します。

違反とする条件は次のとおりです。

- 接続元が`0.0.0.0/0`または`::/0`
- SSH（TCP/22）またはRDP（TCP/3389）を許可している
- 22または3389を含むポート範囲も対象とする
- 全プロトコル許可（`IpProtocol: -1`）も対象とする

一方、`0.0.0.0/0`からのHTTPS（TCP/443）は今回のポリシーでは許可します。

また、CloudFormationではSecurity Groupのインバウンドルールを複数の形式で記述できるため、次の両方を検査対象にします。

- `AWS::EC2::SecurityGroup`内の`SecurityGroupIngress`
- 独立した`AWS::EC2::SecurityGroupIngress`

片方だけを検査すると、同じ設定を別の記述形式で追加した場合にルールを回避できてしまいます。

## 検証用のCloudFormationテンプレート

今回の検証では、判定結果を比較するために3種類のテンプレートを用意しました。

| ファイル | Security Groupの設定 | 期待結果 |
| --- | --- | --- |
| `noncompliant.yaml` | Public SSH/22とPublic RDP/3389 | FAIL |
| `compliant.yaml` | SSH/22の接続元を特定IPに限定 | PASS |
| `public-web.yaml` | Public HTTPS/443 | PASS |

:::message
本記事における「準拠」と「非準拠」は、今回作成したRegoポリシーに対する判定結果です。テンプレート全体の安全性を保証するものではありません。
:::

`noncompliant.yaml`には、インライン形式で記述したPublic SSHと、独立した`AWS::EC2::SecurityGroupIngress`として記述したPublic RDPを含めています。

Public SSHは、`AWS::EC2::SecurityGroup`内の`SecurityGroupIngress`に記述しています。

```yaml
SecurityGroupIngress:
  - IpProtocol: tcp
    FromPort: 22
    ToPort: 22
    CidrIp: 0.0.0.0/0
```

Public RDPは、独立したリソースとして記述しています。

```yaml
PublicRdpIngress:
  Type: AWS::EC2::SecurityGroupIngress
  Properties:
    GroupId: !Ref PublicSshSecurityGroup
    IpProtocol: tcp
    FromPort: 3389
    ToPort: 3389
    CidrIp: 0.0.0.0/0
```

どちらも管理ポートをインターネット全体へ公開しているため、今回のポリシーでは非準拠と判定します。

### 接続元を限定したSSH

`compliant.yaml`では、SSH/22を許可していますが、接続元を`203.0.113.10/32`に限定しています。

```yaml
SecurityGroupIngress:
  - IpProtocol: tcp
    FromPort: 22
    ToPort: 22
    CidrIp: 203.0.113.10/32
```

Public CIDRからのアクセスではないため、今回のポリシーでは準拠と判定します。

なお、`203.0.113.0/24`はドキュメント用のアドレス範囲です。実環境では、管理拠点などの実際のIPアドレスへ置き換える必要があります。

### Public HTTPS

`public-web.yaml`では、HTTPS/443をインターネット全体へ公開しています。

```yaml
SecurityGroupIngress:
  - IpProtocol: tcp
    FromPort: 443
    ToPort: 443
    CidrIp: 0.0.0.0/0
```

接続元はPublic CIDRですが、ポートはSSH/22やRDP/3389ではありません。そのため、今回のポリシーでは準拠と判定します。

このテンプレートは、今回のポリシーが`0.0.0.0/0`を一律に禁止せず、許可する通信と禁止する通信を区別できることを確認するために用意しました。

## Regoでポリシーを定義する

まず、IPv4とIPv6のPublic CIDRを判定します。

```rego
package main

import rego.v1

public_cidr(rule) if {
    rule.CidrIp == "0.0.0.0/0"
}

public_cidr(rule) if {
    rule.CidrIpv6 == "::/0"
}
```

本記事ではRego v1の構文を使用しています。

次に、Public CIDRからSSHを許可している場合、`deny`へ違反メッセージを追加します。

ここで、`ingress_rules`はインライン形式と独立リソース形式のインバウンドルールを共通形式に整理した配列です。`includes_port`は、対象ポートが`FromPort`から`ToPort`までの範囲に含まれるか、または全プロトコル許可であるかを判定するヘルパー関数です。

```rego
deny contains message if {
    some item in ingress_rules
    public_cidr(item.rule)
    includes_port(item.rule, 22)

    message := sprintf(
        "%s allows SSH (22) from the public internet",
        [item.resource_name],
    )
}
```

`deny`にメッセージが1件以上入ると、Conftestは検査を失敗させます。RDP/3389についても同じ考え方でルールを定義しました。

実際のポリシーでは、次の処理も追加しています。

- インライン形式と独立リソース形式のインバウンドルールを抽出する
- TCP/22、TCP/3389だけでなく、それらを含むポート範囲を検出する
- `IpProtocol: -1`をSSH/RDPの両方に対する違反として扱う

ここで重要なのは、単純にPublic CIDRを禁止するのではなく、「許可する通信」と「禁止する通信」をポリシーとして明確に表現することです。

## ポリシー自体をテストする

Policy as Codeを導入しても、ポリシー自体に誤りや検出漏れがあれば安全にはなりません。そのため、次のケースをRegoの単体テストとして用意しました。

| テストケース | 期待結果 |
| --- | --- |
| `0.0.0.0/0` + SSH/22 | FAIL |
| `::/0` + RDP/3389 | FAIL |
| TCP/0～65535 | FAIL（SSH/RDPの2件） |
| 全プロトコル公開 | FAIL（SSH/RDPの2件） |
| 接続元限定 + SSH/22 | PASS |
| `0.0.0.0/0` + HTTPS/443 | PASS |

Conftestから次のコマンドを実行します。

```bash
conftest verify --policy policy
```

実行結果は次のとおりです。

```text
6 tests, 6 passed, 0 warnings, 0 failures, 0 exceptions, 0 skipped
```

![Regoポリシーの単体テスト結果](/images/aws-opa-cloudformation-policy-as-code/rego-policy-test-result.png)

ポリシーを変更するたびにこのテストを実行すれば、既存の判定を壊していないか確認できます。

## ローカルでCloudFormationを検査する

### 準拠テンプレート

接続元を限定したSSHとPublic HTTPSを検査します。

```bash
conftest test \
  templates/compliant.yaml \
  templates/public-web.yaml \
  --policy policy
```

どちらもポリシーに違反しないため、exit code 0で完了しました。

```text
4 tests, 4 passed, 0 warnings, 0 failures, 0 exceptions
```

![準拠テンプレートが検査を通過した結果](/images/aws-opa-cloudformation-policy-as-code/conftest-compliant-result.png)

今回のポリシーでは、各テンプレートに対してPublic SSH/22とPublic RDP/3389の2項目を評価します。そのため、2つのテンプレートを検査した結果、合計`4 tests`となりました。ここでの`tests`はYAMLファイル数ではなく、ポリシーの評価数を表します。

```text
2テンプレート × 2ルール = 4 tests
```

すべての評価で違反が検出されなかったため、`4 passed`と表示されています。ここでの`tests`はテンプレートに対するポリシー評価数であり、`conftest verify`で実行したRegoポリシー自体の単体テストとは異なります。

Public HTTPSも成功しているため、今回のポリシーが`0.0.0.0/0`を一律に拒否していないことを確認できます。

### 非準拠テンプレート

次に、Public SSHとPublic RDPを含むテンプレートを検査します。

```bash
conftest test templates/noncompliant.yaml --policy policy
```

実行結果は次のとおりです。

```text
FAIL - templates/noncompliant.yaml - main - PublicRdpIngress allows RDP (3389) from the public internet
FAIL - templates/noncompliant.yaml - main - PublicSshSecurityGroup allows SSH (22) from the public internet

2 tests, 0 passed, 0 warnings, 2 failures, 0 exceptions
```

![Public SSHとRDPを検出したConftestの実行結果](/images/aws-opa-cloudformation-policy-as-code/conftest-noncompliant-result.png)

Conftestはexit code 1を返します。この非ゼロ終了コードを利用することで、CI/CDのBuildを失敗させられます。

## CodeBuildでデプロイ前に停止する

次に、同じ検査をCodeBuildへ組み込みます。

検証用のCodeBuildには、CloudFormationスタックやEC2リソースを作成する権限を付与していません。必要なのは、Sourceの取得とCloudWatch Logsへの出力など、Build実行に必要な最小限の権限だけです。

### 非準拠テンプレートを検査する

最初のBuildでは、`buildspec.yml`に非準拠テンプレートの検査を設定しました。以下は、ツールのインストール処理を除いた主要部分です。

```yaml
phases:
  pre_build:
    commands:
      - cfn-lint templates/*.yaml

  build:
    commands:
      - conftest verify --policy policy
      - conftest test templates/noncompliant.yaml --policy policy
```

処理の役割は次のように分けています。

| 処理 | 確認内容 |
| --- | --- |
| `cfn-lint` | CloudFormationの構文やリソース仕様 |
| `conftest verify` | Regoポリシー自体の単体テスト |
| `conftest test` | テンプレートがセキュリティポリシーに準拠しているか |

`noncompliant.yaml`には、パブリックインターネットからのSSHおよびRDPを許可するSecurity Groupが含まれています。Conftestが2件のポリシー違反を検出して終了コード1を返したため、CodeBuildのBUILDフェーズも失敗しました。

![非準拠テンプレートによってCodeBuildが失敗した結果](/images/aws-opa-cloudformation-policy-as-code/codebuild-noncompliant-blocked.png)

これにより、後続のDeploy処理を実行する前に、危険な設定を停止できることを確認しました。

### 準拠テンプレートを検査する

次に、`buildspec.yml`の検査対象を準拠テンプレートへ変更して、もう一度Buildを実行しました。以下は主要部分です。

```yaml
phases:
  pre_build:
    commands:
      - cfn-lint templates/*.yaml

  build:
    commands:
      - conftest verify --policy policy
      - conftest test templates/compliant.yaml templates/public-web.yaml --policy policy
      - echo "Policy checks passed. The deployment stage may continue."
```

ここでは、SSH/22の接続元を限定したSecurity Groupと、`0.0.0.0/0`からHTTPS/443を許可したSecurity Groupを検査しています。どちらも今回のポリシーには違反しないため、Conftestは終了コード0を返し、CodeBuildも成功しました。

![準拠テンプレートでCodeBuildが成功した結果](/images/aws-opa-cloudformation-policy-as-code/codebuild-policy-succeeded.png)

この結果から、Public CIDRを一律に拒否するのではなく、禁止対象であるSSHおよびRDPだけを停止できることを確認しました。

:::message
今回の検証では、検査対象を変更した2種類の`buildspec.yml`を使用しました。実運用では、デプロイ対象のテンプレートだけを検査対象に指定するか、環境変数やPipelineの入力によって対象ファイルを切り替える方法が考えられます。
:::

:::message
実運用では、検査とDeployを別ステージ・別IAMロールに分けることで、検査用CodeBuildにCloudFormationやEC2などのリソース作成権限を付与せずに済みます。
:::

## cfn-lintだけでは不十分なのか

`cfn-lint`はCloudFormationリソース仕様に基づき、テンプレートの構文、プロパティ、型などを検査します。

一方、次のような判断は組織やシステムの方針によって異なります。

> Public CIDRからSSHを許可してはならない。ただし、Public HTTPSは許可する。

このような独自のセキュリティ判断をコードとして定義するのが、今回のOPA/Regoの役割です。

| ツール | 主な役割 |
| --- | --- |
| cfn-lint | CloudFormationの構文・リソース仕様を検査 |
| OPA / Conftest | 独自のセキュリティポリシーを検査 |
| AWS Config | AWSリソースの設定を事前または継続的に評価 |

## OPAとAWS Configの役割

AWS Configには、既存リソースを評価するDetective evaluationに加え、デプロイ前のリソース設定を評価できるProactive evaluationがあります。

そのため、「デプロイ前の検査はOPA、デプロイ後はAWS Config」と完全に二分できるわけではありません。それぞれの特徴を整理すると次のようになります。

| 比較項目 | OPA + CI/CD | AWS Config Proactive | AWS Config Detective |
| --- | --- | --- | --- |
| 主な対象 | リポジトリ内のIaC | デプロイ前のリソース設定 | 実際のAWSリソース |
| 実行タイミング | Commit、PR、Build時 | 明示的な事前評価時 | 作成・変更後、定期実行時 |
| CI/CDへの組み込み | 任意のPipelineで実行可能 | APIなどを利用して連携 | 主に継続監視 |
| 手動変更の検出 | できない | できない | できる |
| デプロイ後の設定変更 | 検出できない | 検出できない | 検出できる |
| AWS以外への展開 | TerraformやKubernetesにも応用可能 | AWSリソース | AWSリソース |

なお、AWS ConfigのProactive evaluationは、有効化するだけでCloudFormationのデプロイを自動的に停止する仕組みではありません。`StartResourceEvaluation` APIなどを呼び出し、その評価結果に応じてPipelineを停止する処理を組み込む必要があります。また、Proactive evaluationに対応するリソースタイプとルールには制限があります。

今回OPAを選んだ理由は、CloudFormationだけでなくTerraformやKubernetesなどにも応用でき、ポリシーとテストをアプリケーションコードと同じリポジトリで管理できるためです。

ただし、CI/CDを経由しないコンソール操作やデプロイ後の変更はOPAだけでは検出できません。実運用ではAWS Config Detective evaluationなどの継続監視も必要です。

## CloudFormation Guardという選択肢

CloudFormationを中心に利用する場合は、AWS CloudFormation Guardも有力な選択肢です。GuardはJSON/YAML形式のデータをルールに基づいて検証でき、AWS公式ドキュメントでもCI/CDでCloudFormationテンプレートを事前検査する方法が案内されています。

| 要件 | 向いている選択肢 |
| --- | --- |
| CloudFormationテンプレートをAWS公式のPolicy as Codeツールで検査したい | CloudFormation Guard |
| TerraformやKubernetesなど、CloudFormation以外にもポリシーを展開したい | OPA |
| 組織内でRegoを共通のポリシー言語として利用したい | OPA |

どちらが常に優れているというものではなく、対象範囲や既存の運用に合わせて選択する必要があります。

## 制限事項と実運用での検討点

### Intrinsic Functionsを含む場合

今回のPoCは、ポート番号とCIDRがCloudFormationテンプレート内に直接記述されているケースを対象としています。

次のように値が実行時に決まる場合、単純な静的検査では最終的なポート番号を判断できません。

```yaml
FromPort: !Ref ManagementPort
ToPort: !Ref ManagementPort
```

このようなケースでは、実際のデプロイパラメータをCI/CDへ渡し、`!Ref`を解決したうえでポリシーを評価する必要があります。パラメータ化されたCloudFormationテンプレートの検査方法については、別の記事で検証します。

### 実運用で検討すべき点

今回の仕組みを実運用へ発展させる場合は、次の点も検討する必要があります。

- CDKでは`cdk synth`後のCloudFormationテンプレートを検査する
- ポリシー例外に理由、責任者、有効期限を設定する
- ルール変更をPull Requestでレビューする
- ポリシー自体の単体テストを継続する
- CI/CDを通らない変更をAWS Configなどで検出する

特に例外管理は重要です。例外が必要になるたびにポリシーを削除・無効化すると、Policy as Codeを導入した意味がありません。例外の理由と期限を記録し、レビュー可能な形で管理する必要があります。

## まとめ

OPAとConftestを利用し、危険なSecurity GroupをCloudFormationのデプロイ前に検出しました。

- Public SSH/RDPを検出し、Public HTTPSは許可できた
- Conftestの非ゼロ終了コードを利用してCodeBuildを停止できる
- ポリシー自体にも単体テストが必要
- OPAはCI/CD内の事前検査に利用できる
- デプロイ後や手動変更の監視にはAWS Configなどを併用する必要がある

Policy as Codeで重要なのは、単に多くの設定を禁止することではありません。システムで許可する通信と禁止する通信を明確にし、その判断をレビュー・テスト可能なコードとして管理することだと感じました。

今回のPoCではSecurity Groupを対象にしましたが、同じ考え方は暗号化、タグ、IAM権限などにも展開できます。

本記事が、CloudFormationのセキュリティチェックやPolicy as Codeの導入を検討する際の参考になれば幸いです。

## 参考資料

https://www.openpolicyagent.org/docs/
https://www.conftest.dev/
https://docs.aws.amazon.com/ja_jp/config/latest/developerguide/evaluate-config.html
https://docs.aws.amazon.com/ja_jp/config/latest/developerguide/evaluate-config_turn-on-proactive-rules.html
https://docs.aws.amazon.com/ja_jp/config/latest/developerguide/evaluate-config_components.html
https://docs.aws.amazon.com/ja_jp/AWSCloudFormation/latest/UserGuide/best-practices.html
https://github.com/aws-cloudformation/cfn-lint
