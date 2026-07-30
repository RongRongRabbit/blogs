---
title: Amazon CloudWatch Logs メトリクスフィルターの Filter Pattern 実践ガイド｜JSON・Regex・HTTPログを検証
emoji: 🔍
type: tech
topics:
  - aws
  - cloudwatch
  - monitoring
  - cloudwatchlogs
published: false
date: "2026-07-31"
---
こんにちは、宋です。

Amazon CloudWatch Logs の**メトリクスフィルター（Metric Filter）**を利用すると、条件に一致したログイベントを CloudWatch メトリクスへ変換できます。

CloudWatch Alarm や Amazon SNS と組み合わせることで、次のような監視が可能です。

- CloudTrail の AccessDenied を通知する
- Root ユーザーの利用を検知する
- Lambda のエラーを通知する
- Web サーバーの HTTP エラーを監視する
- アプリケーションログの ERROR を監視する

一方で、メトリクスフィルターを設定する際に悩みやすいのが **Filter Pattern** です。

CloudWatch Logs のメトリクスフィルターでは、Filter Pattern を正しく記述できないと、通知したいログが検知されなかったり、逆に不要なログまで通知されたりします。

CloudWatch コンソールにはサンプルが用意されていますが、「どの Pattern を使えばよいのか」「Regex はどのように書くのか」と迷うことも少なくありません。

![フィルターパターンの入力欄とサンプル](/images/cloudwatch-logs-metric-filter/sample-pattern.png)

そこで本記事では、代表的な Filter Pattern を実際のログを使って検証します。

---

## Filter Pattern の種類

Filter Pattern は、対象となるログの形式に応じて使い分けます。

|種類|対象ログ|主な用途|
|---|---|---|
|Standalone Pattern|プレーンテキストログ|ERRORやWARNなどの文字列検索|
|Space-delimited Pattern|スペース区切りログ|ApacheやNginxなどのアクセスログ|
|JSON Pattern|JSONログ|CloudTrailやLambdaなどのログ|

また、**Regex（正規表現）は独立した Pattern の種類ではなく、各 Pattern の条件として利用するもの**です。

例えば、次の Pattern は通常の文字列検索です。

```text
ERROR
```
`%...%` で囲むと、Regex として評価されます。

```text
%ERROR%
```

JSON Pattern でも、次のように Regex を指定できます。

```text
{ $.statusCode = %4[0-9][0-9]% }
```

本記事では、次の順番で検証します。

1. Standalone Pattern
2. Space-delimited Pattern
3. JSON Pattern
4. Regex

---

## 検証環境

今回は、CloudWatch Logs メトリクスフィルターの作成画面にある **「パターンのテスト」** 機能を利用します。

それぞれの Pattern について、次の観点で確認します。

- どのようなログに利用するのか
- Filter Pattern をどのように記述するのか
- どのログが条件に一致するのか

---

## 検証① Standalone Pattern

### Standalone Pattern とは

Standalone Pattern は、プレーンテキストログから特定の文字列を検索する、最もシンプルな Filter Pattern です。

今回は次のサンプルログを利用します。

```text
INFO Application started
WARN CPU usage is high
ERROR Database connection failed
INFO Shutdown completed
```

ERROR を含むログだけを検出する場合は、次のように記述します。

```text
ERROR
```

### 検証結果

|ログ|一致|
|---|:---:|
|INFO Application started|❌|
|WARN CPU usage is high|❌|
|ERROR Database connection failed|✅|
|INFO Shutdown completed|❌|

期待どおり、ERROR を含むログだけが一致しました。

![Standalone Pattern のテスト結果](/images/cloudwatch-logs-metric-filter/standalone-pattern.png)

Standalone Pattern は、アプリケーションログやシステムログから、ERROR、WARN、Exception などを検出する用途に適しています。

### Regex を利用する場合

Standalone Pattern では、Regex も利用できます。

```text
%ERROR%
```

単純な ERROR の検索では通常の文字列検索と大きな違いはありませんが、複数の文字列や一定の規則を持つ文字列を検索する場合に便利です。

Regex の詳しい例は、後半で紹介します。

---

## 検証② Space-delimited Pattern

### Space-delimited Pattern とは

Space-delimited Pattern は、スペース区切りで出力されるログを対象とした Filter Pattern です。

JSON Pattern のようにキー名を指定するのではなく、**各フィールドの位置を定義して条件を指定します**。

主に次のようなログで利用できます。

- Apache Access Log
- Nginx Access Log
- スペース区切りのカスタムログ

今回は、Apache のアクセスログを例に検証します。

```text
127.0.0.1 - frank [10/Oct/2000:13:55:36 -0700] "GET /apache_pb.gif HTTP/1.0" 200 2326
192.168.10.10 - john [10/Oct/2000:14:02:31 -0700] "GET /login HTTP/1.1" 404 1024
10.0.0.10 - alice [10/Oct/2000:14:05:10 -0700] "POST /login HTTP/1.1" 500 2048
```

各フィールドは次のように定義できます。

```text
[ip, identity, user, timestamp, request, status_code, size]
```
ip や status_code などのフィールド名は任意に指定できます。
重要なのは、実際のログにおける各フィールドの順序と、Filter Pattern の定義順を一致させることです。

### HTTP 4xx を検出する

HTTP ステータスコードが 4xx のログだけを検出する場合は、次のように記述します。
```text
[ip, identity, user, timestamp, request, status_code = 4*, size]
```

### 検証結果

|HTTP Status|一致|
|---|:---:|
|200|❌|
|404|✅|
|500|❌|

期待どおり、404 のログだけが一致しました。

![HTTP 4xx のテスト結果](/images/cloudwatch-logs-metric-filter/space-delimited-pattern.png)

### ワイルドカードを利用する

評価しないフィールドは、`...` を使って省略できます。

```text
[..., status_code = 4*, size]
```

フィールド数が多い場合は、すべてのフィールドを記述するよりも簡潔に記述できます。

:::message alert
`...` は **1 つの Filter Pattern 内で 1 回だけ**利用できます。

例えば、次のように前後へ同時に指定するとエラーになります。

```text
[..., status_code = 4*, ...]
```

エラーメッセージ:
```text
Duplicate field '...'
```
:::

ただし、Space-delimited Pattern はログの構造に依存します。ログ形式やフィールドの順番が変更された場合は、Filter Pattern も見直す必要があります。

---

## 検証③ JSON Pattern

### JSON Pattern とは

JSON Pattern は、JSON のキーと値を指定してログを検索する Filter Pattern です。

CloudTrail や Lambdaのログ など、多くの AWS サービスが JSON 形式のログを出力するため、AWS 環境では利用する機会が多い Pattern です。

今回は、次の CloudTrail 形式のサンプルログを利用します。

```json
{
  "eventVersion": "1.11",
  "eventTime": "2026-07-30T10:00:00Z",
  "eventSource": "iam.amazonaws.com",
  "eventName": "CreateUser",
  "sourceIPAddress": "192.168.12.123",
  "userIdentity": {
    "type": "IAMUser",
    "userName": "alice"
  },
  "errorCode": "AccessDenied",
  "responseElements": null,
  "readOnly": false
}
```

### 文字列の完全一致

`eventName` が `CreateUser` のイベントだけを検出する場合は、次のように記述します。

```text
{ $.eventName = "CreateUser" }
```

### 検証結果

✅ 一致

![文字列の完全一致のテスト結果](/images/cloudwatch-logs-metric-filter/exact-match-pattern.png)

CloudTrail の API 名など、特定の値を監視する場合に利用できます。

### ネストした JSON を検索する

ネストした項目は、`.` を使って階層を指定します。

例えば、`userIdentity` の中にある `userName` を検索する場合は、次のように記述します。

```text
{ $.userIdentity.userName = "alice" }
```

### 検証結果

✅ 一致
![ネストしたJSONのテスト結果](/images/cloudwatch-logs-metric-filter/nested-json-pattern.png)


### 複数条件を組み合わせる

複数の条件を `&&` で組み合わせることもできます。

```text
{
  ($.eventName = "CreateUser")
  &&
  ($.errorCode = "AccessDenied")
}
```

この Pattern では、`CreateUser` API の実行時に AccessDenied が発生したイベントだけが一致します。

### 検証結果

✅ 一致
![複数条件を組み合わせるテスト結果](/images/cloudwatch-logs-metric-filter/multiple-conditions-pattern.png)

### 存在・Null を判定する

JSON Pattern では、項目の存在や Null も判定できます。

`errorCode` が存在するイベントを検出する例です。

```text
{ $.errorCode = * }
```
![存在を判定するテスト結果](/images/cloudwatch-logs-metric-filter/field-existence-pattern.png)


`responseElements` が Null のイベントを検出する場合は、次のように記述します。

```text
{ $.responseElements IS NULL }
```
![Nullを判定するテスト結果](/images/cloudwatch-logs-metric-filter/null-pattern.png)


キー自体が存在しないイベントは、次の Pattern で検出できます。

```text
{ $.responseElements NOT EXISTS }
```

![NotExistsを判定するテスト結果](/images/cloudwatch-logs-metric-filter/not-exists-pattern.png)

`IS NULL` と `NOT EXISTS` は意味が異なります。

- `IS NULL`：キーが存在し、値が Null
- `NOT EXISTS`：キー自体が存在しない

---

## JSON PatternでRegexを利用する
Regex は Standalone Pattern や JSON Pattern など、各 Pattern の条件として利用できます。

Regex は `%...%` で囲みます。

### 前方一致

例えば、`sourceIPAddress` が `192.168.12.` から始まるログを検索する場合は、次のように記述します。

```text
{ $.sourceIPAddress = %^192\.168\.12\.% }
```

- `^`：文字列の先頭
- `\.`：ドットを文字として扱う

### 検証結果

✅ 一致

![Regexを判定するテスト結果](/images/cloudwatch-logs-metric-filter/regex-pattern.png)

### 否定条件

指定した Regex に一致しないログを検出する場合は、`!=` を利用します。

```text
{ $.sourceIPAddress != %^192\.168\.12\.% }
```
![Regexを判定するテスト結果](/images/cloudwatch-logs-metric-filter/regex-exclusion-pattern.png)

この Pattern では、`192.168.12.` から始まらない IP アドレスが一致します。

特定の送信元 IP アドレスを監視対象から除外する場合などに利用できます。

### 複数のIPアドレスに一致させる

次の Pattern は、末尾が `120` または `121` の IP アドレスに一致します。

```text
{ $.sourceIPAddress = %^192\.168\.12\.12[0-1]$% }
```

一致する値は次の2つです。

```text
192.168.12.120
192.168.12.121
```

- `[0-1]`：0または1
- `$`：文字列の末尾
![複数のIPアドレスに一致させるテスト結果](/images/cloudwatch-logs-metric-filter/regex-anchors-pattern.png)

### Regex利用時の注意点

CloudWatch Logs で Regex を利用する場合は、次の点に注意が必要です。

- Regex は `%...%` で囲む
- `.` を文字として検索する場合は `\.` と記述する
- 利用できる Regex 構文には制限がある
- 複雑な Pattern は事前にテストする
- 実際のログ形式や値を確認してから条件を作成する

特に除外条件では、Pattern が想定より広い範囲に一致すると、監視対象となるログまで除外してしまう可能性があります。

設定前に「パターンのテスト」を利用し、一致するログと一致しないログの両方を確認することが重要です。

---

## まとめ

CloudWatch Logs のメトリクスフィルターでは、ログ形式に応じて適切な Filter Pattern を選択することが重要です。

本記事では、次の Pattern を実際のログを使って検証しました。

|Pattern|対象ログ|主な用途|
|---|---|---|
|Standalone Pattern|プレーンテキストログ|ERRORやWARNなどの文字列検索|
|Space-delimited Pattern|スペース区切りログ|HTTPステータスコードなどの検索|
|JSON Pattern|JSONログ|キーや値を指定した検索|
|Regex|各形式のログ|前方一致、範囲指定、除外条件|

特に CloudTrail や Lambda のような JSON ログでは、JSON Pattern と Regex を組み合わせることで、AccessDenied の検知や特定 IP アドレスの除外など、柔軟な条件を記述できます。

Filter Pattern を作成する際は、構文だけでなく、**対象ログの形式と実際の値を確認すること**が大切です。

「パターンのテスト」機能を活用し、一致するログと一致しないログの両方を確認しながら調整することをおすすめします。


本記事が、CloudWatch Logs のメトリクスフィルターや Filter Pattern を理解する際の参考になれば幸いです。

## 参考資料


  https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/FilterAndPatternSyntax.html

  https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/matching-terms-json-log-events.html

  https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/matching-terms-unstructured-log-events.html

  https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/matching-terms-space-delimited-log-events.html

  https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/MonitoringLogData.html