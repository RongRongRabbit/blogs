---
title: "Lambda不要！Step FunctionsでEC2バックアップ｜UTC・JST日時付きのAMI名を生成する"
emoji: "🏷️"
type: "tech"
topics:
  - aws
  - stepfunctions
  - ec2
  - ami
  - automation
published: true
date: "2026-09-14"
---

## はじめに

こんにちは、宋です。

前回、Step Functions を利用した EC2 の AMI バックアップを検証し、AMI 作成時の待機処理について記事を書きました。

https://zenn.dev/takuyousou/articles/step-functions-ami-backup-waiting

今回は同じ AMI バックアップの仕組みの中から、**AMI の名前をどのように生成するか**に注目します。

AMI を定期的に作成する場合、例えば次のようにサーバー名と実行日時を含めておくと、いつ取得した AMI なのか確認しやすくなります。

```text
<server-name>-20260907001026
```

Lambda を利用して日時を取得し、文字列を生成することもできますが、AMI 名を生成するためだけに Lambda を追加するのは少し大げさです。

Step Functions では、Context Object から Execution の開始時刻を取得でき、Intrinsic Functions や JSONata を利用して日時や文字列を加工できます。

そこで今回は Lambda を使わず、同じ `Execution.StartTime` から、

- Intrinsic Functions を利用した UTC 日時付きの AMI 名
- JSONata を利用した JST 日時付きの AMI 名

の2パターンを生成し、それぞれの実装方法を確認してみます。

## Execution.StartTime から日時を取得する

Step Functions では Context Object から、実行中の Execution に関する情報を取得できます。

今回利用するのは次の値です。

```text
$$.Execution.StartTime
```

今回の検証では、次の値を取得できました。

```text
2026-09-06T15:10:26.740Z
```

`Execution.StartTime` は ISO 8601 形式で取得でき、末尾の `Z` は UTC を表しています。

まずはこの値をそのまま利用して、UTC 日時付きの AMI 名を生成してみます。

## UTC：Intrinsic Functions で AMI 名を生成する

UTC の AMI 名では、`Execution.StartTime` から年月日・時分秒を取り出し、AMI 名として組み立てます。

今回は `States.StringSplit` と `States.ArrayGetItem` を利用して日時を分解します。

```json
"BuildAmiPartsUTC": {
  "Type": "Pass",
  "Parameters": {
    "year.$": "States.ArrayGetItem(States.StringSplit($$.Execution.StartTime, '-'), 0)",
    "month.$": "States.ArrayGetItem(States.StringSplit($$.Execution.StartTime, '-'), 1)",
    "day.$": "States.ArrayGetItem(States.StringSplit(States.ArrayGetItem(States.StringSplit($$.Execution.StartTime, '-'), 2), 'T'), 0)",
    "timeFull.$": "States.ArrayGetItem(States.StringSplit($$.Execution.StartTime, 'T'), 1)"
  },
  "ResultPath": "$.utcParts",
  "Next": "FormatAmiNameUTC"
}
```

これによって、次のような値に分解できます。

```json
{
  "year": "2026",
  "month": "09",
  "day": "06",
  "timeFull": "15:10:26.740Z"
}
```

次に、分解した値を `States.Format` で組み合わせて AMI 名を生成します。

```json
"FormatAmiNameUTC": {
  "Type": "Pass",
  "Parameters": {
    "InstanceId.$": "$.InstanceId",
    "serverName.$": "$.serverName",
    "executionStartTime.$": "$$.Execution.StartTime",
    "utcAmiName.$": "States.Format('{}-{}{}{}{}{}{}', $.serverName, $.utcParts.year, $.utcParts.month, $.utcParts.day, States.ArrayGetItem(States.StringSplit($.utcParts.timeFull, ':'), 0), States.ArrayGetItem(States.StringSplit($.utcParts.timeFull, ':'), 1), States.ArrayGetItem(States.StringSplit(States.ArrayGetItem(States.StringSplit($.utcParts.timeFull, ':'), 2), '.'), 0))"
  },
  "ResultPath": "$.utcInfo",
  "Next": "BuildAmiNameJST"
}
```

今回の検証では、`serverName` に `ami-backup-demo` を指定しています。

実際に実行すると、次の AMI 名が生成されました。

```text
ami-backup-demo-20260906151026
```

![Execution.StartTimeから生成したUTCのAMI名](/images/step-functions-ec2-backup-ami-name/step-functions-ami-name-utc.png)

この処理では時刻そのものを変換しているわけではなく、UTC の `Execution.StartTime` を文字列として分解し、AMI 名として組み立てています。

そのため、生成される AMI 名も UTC ベースになります。

システム全体を UTC で管理する場合は、この形式でも問題ありません。

## JST：JSONata で AMI 名を生成する

次に、同じ `Execution.StartTime` から JST 日時付きの AMI 名を生成します。

UTC の AMI 名では、`Execution.StartTime` の文字列を Intrinsic Functions で分解・結合しました。

一方、JST の AMI 名を生成する場合は、UTC から JST への時差を考慮する必要があります。

Intrinsic Functions にはタイムゾーンを指定して日時をフォーマットする機能がないため、日時の加算や日付変更まで個別に処理すると実装が複雑になります。

例えば今回取得した時刻は、

```text
UTC : 2026-09-06 15:10:26
```

ですが、日本時間では、

```text
JST : 2026-09-07 00:10:26
```

となり、単純に時刻が9時間進むだけでなく、日付も翌日に変わります。

そこで今回は JSONata の日時関数を利用し、`+0900` を指定して `Execution.StartTime` を JST としてフォーマットします。

State Machine 全体を JSONata に変更するのではなく、AMI 名を生成する `Pass` State のみ `QueryLanguage` に `JSONata` を指定しています。

なお、検証結果を比較するため、前の State で生成した `utcAmiName` も出力しています。

```json
"BuildAmiNameJST": {
  "Type": "Pass",
  "QueryLanguage": "JSONata",
  "Output": {
    "InstanceId": "{% $states.input.InstanceId %}",
    "serverName": "{% $states.input.serverName %}",
    "executionStartTime": "{% $states.context.Execution.StartTime %}",
    "utcAmiName": "{% $states.input.utcInfo.utcAmiName %}",
    "jstTime": "{% $fromMillis($toMillis($states.context.Execution.StartTime), '[Y0001]-[M01]-[D01] [H01]:[m01]:[s01]', '+0900') %}",
    "amiName": "{% $states.input.serverName & '-' & $fromMillis($toMillis($states.context.Execution.StartTime), '[Y0001][M01][D01][H01][m01][s01]', '+0900') %}"
  },
  "Next": "CreateAMI"
}
```

ポイントは、`$states.context.Execution.StartTime` から Execution の開始時刻を取得し、`$fromMillis` のタイムゾーンとして `+0900` を指定している部分です。

```json
"jstTime": "{% $fromMillis($toMillis($states.context.Execution.StartTime), '[Y0001]-[M01]-[D01] [H01]:[m01]:[s01]', '+0900') %}"
```

まず `$toMillis` で `Execution.StartTime` をミリ秒に変換し、`$fromMillis` で JST の日時としてフォーマットします。

AMI 名についても、同じ `Execution.StartTime` から直接生成します。

```json
"amiName": "{% $states.input.serverName & '-' & $fromMillis($toMillis($states.context.Execution.StartTime), '[Y0001][M01][D01][H01][m01][s01]', '+0900') %}"
```

これによって、次の JST 日時付きの AMI 名を生成できます。

```text
ami-backup-demo-20260907001026
```

## UTC と JST の実行結果を比較する


今回の実行結果を比較すると、次のようになりました。

| 比較項目 | UTC | JST |
| --- | --- | --- |
| 基準となる値 | `Execution.StartTime` | `Execution.StartTime` |
| 今回利用した方法 | Intrinsic Functions | JSONata |
| 処理内容 | 文字列を分解・結合 | `+0900` を指定してフォーマット |
| 日時 | `2026-09-06 15:10:26` | `2026-09-07 00:10:26` |
| AMI 名 | `ami-backup-demo-20260906151026` | `ami-backup-demo-20260907001026` |

![UTCとJSTで生成したAMI名の比較](/images/step-functions-ec2-backup-ami-name/step-functions-ami-name-jst.png)

同じ `Execution.StartTime` を基準にしても、UTC のまま利用する場合と `+0900` を指定して JST としてフォーマットする場合で、生成される日時と AMI 名が異なることを確認できました。

今回の検証では UTC から JST への変換によって日付も `2026-09-06` から `2026-09-07` へ正しく切り替わることを確認できました。

:::message
UTC と JST のどちらを利用するかは、システムの運用方針によって異なります。

システム全体を UTC で統一している場合は UTC のままでも問題ありません。今回は日本時間でバックアップ取得日時を確認しやすくするため、最終的な AMI 名には JST を利用しています。
:::

## 生成した JST の AMI 名で実際に AMI を作成する

最後に、JST の日時から生成した `amiName` を EC2 の `CreateImage` に渡します。

```json
"CreateAMI": {
  "Type": "Task",
  "Resource": "arn:aws:states:::aws-sdk:ec2:createImage",
  "Parameters": {
    "InstanceId.$": "$.InstanceId",
    "Name.$": "$.amiName"
  },
  "ResultPath": "$.createImageResult",
  "Next": "StartInstance"
}
```

生成した `amiName` は、次のように `Name` に指定しています。

```json
"Name.$": "$.amiName"
```

`BuildAmiNameJST` で生成した値が、そのまま AMI の名前として利用されます。

実際に EC2 コンソールから確認すると、

```text
ami-backup-demo-20260907001026
```

という名前で AMI が作成されていました。

![JST日時付きの名前で作成されたAMI](/images/step-functions-ec2-backup-ami-name/generated-ami-name-jst.png)

AMI の作成日時も `2026/09/07 00:10 GMT+9` となっており、Step Functions で生成した JST の日時と一致していることを確認できました。

## まとめ

今回は Step Functions の `Execution.StartTime` を利用して、Lambda を使わずに UTC・JST 日時付きの AMI 名を生成しました。

UTC の AMI 名では、Intrinsic Functions を利用して `Execution.StartTime` の文字列を分解・結合しました。

一方、JST の AMI 名では時差や日付変更を考慮する必要があるため、JSONata の日時関数を利用し、`+0900` を指定してフォーマットしました。

今回の検証結果を整理すると、次のようになります。

| | UTC | JST |
| --- | --- | --- |
| 利用した機能 | Intrinsic Functions | JSONata |
| 主な処理 | `StringSplit` / `ArrayGetItem` / `Format` | `$toMillis` / `$fromMillis` |
| タイムゾーン処理 | なし | `+0900` |
| 生成結果 | `ami-backup-demo-20260906151026` | `ami-backup-demo-20260907001026` |

今回のような日時や文字列の加工であれば、そのためだけに Lambda を追加する前に、Step Functions の Intrinsic Functions や JSONata で実現できないか確認してみるのもよいと思います。

また、Intrinsic Functions と JSONata のどちらを利用するかについても、単純な文字列加工なのか、タイムゾーンを含む日時処理なのかによって使い分けることで、State Machine の処理をシンプルにできる場合があります。

同じように Step Functions で EC2 の AMI 作成を自動化している方の参考になれば幸いです。

## 参考資料
https://docs.aws.amazon.com/ja_jp/step-functions/latest/dg/intrinsic-functions.html

https://docs.aws.amazon.com/ja_jp/step-functions/latest/dg/input-output-contextobject.html

https://docs.aws.amazon.com/ja_jp/step-functions/latest/dg/transforming-data.html