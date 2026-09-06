---
title: "Lambda不要！Step FunctionsでEC2をバックアップ｜JST日時付きのAMI名を生成する"
emoji: "🏷️"
type: "tech"
topics:
  - aws
  - stepfunctions
  - ec2
  - ami
  - automation
published: false
date: "2026-09-07"
---

## はじめに
こんにちは、宋です。

前回、Step Functions を利用した EC2 の AMI バックアップを検証し、AMI 作成時の待機処理について記事を書きました。

https://zenn.dev/takuyousou/articles/step-functions-ami-backup-waiting

今回は同じ AMI バックアップの仕組みの中から、**AMI の名前をどのように生成するか**に注目します。

AMI を定期的に作成する場合、例えば次のようにサーバー名と実行日時を含めておくと、いつ取得した AMI なのか確認しやすくなります。

```text
<instance-name>-20260907001026
```

Lambda を利用して日時を取得し、文字列を生成することもできますが、AMI 名を生成するためだけに Lambda を追加するのは少し大げさです。

Step Functions では、Context Object から Execution の開始時刻を取得でき、Intrinsic Functions を利用した文字列操作もできます。

そこで今回は、**Lambda を使わず、Step Functions だけで日時付きの AMI 名を生成**してみます。

また、`Execution.StartTime` をそのまま利用すると UTC になるため、後半では JST の日時を AMI 名に利用する方法も確認します。


## Execution.StartTimeから日時を取得する

Step Functions では Context Object から、実行中の Execution に関する情報を取得できます。

今回利用するのは次の値です。

```text
$$.Execution.StartTime
```

例えば、今回の検証では次の値を取得できました。

```text
2026-09-06T15:10:26.740Z
```

この値から年月日、時分秒を取り出し、AMI 名として利用します。

まず `States.StringSplit` と `States.ArrayGetItem` を利用して日時を分解します。

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

これによって、例えば次のような値に分解できます。

```json
{
  "year": "2026",
  "month": "09",
  "day": "06",
  "timeFull": "15:10:26.740Z"
}
```

## UTCの日時でAMI名を生成する

次に、分解した値を `States.Format` で組み合わせます。

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
今回の検証では、対象 EC2 インスタンスの名前として `ami-backup-demo` を使用しています。

実際に実行すると、次の AMI 名が生成されました。

```text
ami-backup-demo-20260906151026
```

![Execution.StartTimeから生成したUTCのAMI名](/images/step-functions-ec2-backup-ami-name/step-functions-ami-name-utc.png)

実行結果を見ると、

```text
executionStartTime : 2026-09-06T15:10:26.740Z
utcAmiName         : ami-backup-demo-20260906151026
```

となっており、Execution の開始日時から AMI 名を生成できています。

ただし、ここで注意したいのが `Execution.StartTime` の末尾にある `Z` です。

この時刻は UTC であるため、そのまま年月日と時刻を取り出すと、AMI 名も UTC ベースになります。

UTC で管理するのであればこのままでも問題ありませんが、日本で運用する際に AMI 名を見ただけで取得日時を判断したい場合は、JST の方が分かりやすいケースもあります。

そこで、JST に変換した日時から AMI 名を生成してみます。

## JSTの日時でAMI名を生成する

今回は JST への変換部分に JSONata を利用しました。

State Machine 全体を JSONata に変更するのではなく、AMI 名を生成する `Pass` State のみ `QueryLanguage` を `JSONata` にしています。

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

ポイントは `$fromMillis` のタイムゾーンとして `+0900` を指定している部分です。

今回の実行結果では、次のようになりました。

```text
Execution.StartTime
2026-09-06T15:10:26.740Z

UTC
2026-09-06 15:10:26

JST
2026-09-07 00:10:26
```

生成された AMI 名も、

```text
UTC : ami-backup-demo-20260906151026
JST : ami-backup-demo-20260907001026
```

となりました。

![UTCからJSTへ変換して生成したAMI名](/images/step-functions-ec2-backup-ami-name/step-functions-ami-name-jst.png)

今回はちょうど UTC から JST への変換によって日付をまたぐ実行結果となりました。

単純に表示上の時刻だけを変更するのではなく、`2026-09-06` から `2026-09-07` へ日付も正しく変換されていることを確認できます。

:::message
UTC の日時を AMI 名として利用すること自体に問題があるわけではありません。

システム全体で UTC に統一して管理する場合は、`Execution.StartTime` をそのまま利用する方法もシンプルです。

今回は、日本時間でバックアップ取得日時を確認しやすくすることを目的として JST に変換しています。
:::

## 生成したAMI名をCreateImageに渡す

最後に、生成した `amiName` を EC2 の `CreateImage` に渡します。

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

ここで重要なのは次の部分です。

```json
"Name.$": "$.amiName"
```

`BuildAmiNameJST` で生成した値を、そのまま AMI の `Name` として利用しています。

実際に EC2 コンソールから確認すると、

```text
ami-backup-demo-20260907001026
```

という名前で AMI が作成されていました。

![JST日時付きの名前で作成されたAMI](/images/step-functions-ec2-backup-ami-name/generated-ami-name-jst.png)

AMI の作成日時も `2026/09/07 00:10 GMT+9` となっており、Step Functions で生成した JST の日時と一致していることを確認できました。

## まとめ

今回は Step Functions の Execution 開始日時を利用して、Lambda を使わずに日時付きの AMI 名を生成しました。

UTC のまま利用する場合は、

- `$$.Execution.StartTime`
- `States.StringSplit`
- `States.ArrayGetItem`
- `States.Format`

を組み合わせることで、JSONPath の State だけでも AMI 名を生成できます。

一方、JST の日時を利用したい場合は、今回は AMI 名を生成する State のみ JSONata に変更し、`+0900` を指定して日時をフォーマットしました。

結果として、

```text
Execution.StartTime
2026-09-06T15:10:26.740Z
        ↓
UTC
ami-backup-demo-20260906151026
        ↓
JST
ami-backup-demo-20260907001026
        ↓
CreateImage
```

という流れを Step Functions 内で完結できました。

今回のような比較的シンプルな文字列生成であれば、処理のためだけに Lambda を追加する前に、Step Functions の Intrinsic Functions や JSONata で実現できないか確認してみるのもよいと思います。

同じように Step Functions で EC2 の AMI 作成を自動化している方の参考になれば幸いです。

## 参考資料
https://docs.aws.amazon.com/ja_jp/step-functions/latest/dg/intrinsic-functions.html

https://docs.aws.amazon.com/ja_jp/step-functions/latest/dg/input-output-contextobject.html

https://docs.aws.amazon.com/ja_jp/step-functions/latest/dg/transforming-data.html