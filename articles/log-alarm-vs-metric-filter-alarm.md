---
title: "Log Alarm登場で何が変わった？Metric Filterとの違いを検証する"
emoji: "🔎"
type: "tech"
topics:
  - aws
  - cloudwatch
  - monitoring
  - logs
  - alarm
published: true
date: "2026-10-12"
---

## はじめに

CloudWatch Logsでエラーを検知したいとき、これまではMetric Filterでログをメトリクスに変換し、Metric Alarmで監視する構成をよく使っていました。

2026年7月に、Logs Insightsのクエリ結果からアラームを作成できる**Log Alarm**が登場しました。今回は東京リージョンで検証します。

気になったのは、**Metric Filter + Metric Alarmと比べて、設定や運用がどう変わるのか**という点です。

Metric Filterでも、ERROR件数を数えたり、JSONフィールドから処理時間を取り出したりできます。そこで、検知結果に加えて、監視対象を追加するときの作業も比べます。

今回は、次の2つのケースを用意しました。

- 複数EC2のうち、**どのインスタンスでエラーが増えたか**を検知する
- バッチが成功していても、**処理時間が長くなっていないか**を検知する

この記事では、**異常を検知できるか、監視対象が増えたときに設定を追加する必要があるか**を確認します。


## 本記事の対象者

- CloudWatch Logsを使った監視を設計・運用している方
- Metric Filter + Metric Alarmを使ったことがあり、Log Alarmとの差が気になっている方
- 監視対象が増えたときの管理や、料金まで含めて方式を選びたい方

## 2つの監視方式の違い

ざっくり言うと、**ログからメトリクスを作って監視するか、ログを定期的にクエリして、その集計結果を監視するか**の違いです。

| | Metric Filter + Metric Alarm | Log Alarm |
|---|---|---|
| 監視までの流れ | ログ → Metric Filter → Custom Metric → Alarm | ログ → Scheduled Query → Alarm |
| ログの評価 | 取り込み時にフィルタリング | 指定間隔でクエリを実行 |
| インスタンス別の集計 | Dimensionを利用 | `by instanceId`（Contributor）を利用 |
| 処理時間などの数値 | Metric Filterで値を抽出 | 集計式でログの値を計算 |
| 評価の単位 | 各期間のメトリクス値（データポイント） | 各回のクエリの集計結果 |
| 注意したい点 | メトリクス数・アラーム数・再利用 | スキャン量・検索時間範囲・Contributor数の上限 |

![2つの監視構成の比較](/images/log-alarm-vs-metric-filter-alarm/01-architecture.png)

Log Alarmを作成すると、CloudWatchが**AWS管理のScheduled Query**を自動で作成します。このクエリはCloudWatch LogsのScheduled Queries画面に表示されますが、直接は編集できず、アラーム側の設定変更で更新されます。アラームを削除すると一緒に削除されます。

以下では、同じログと閾値を使って両方式を比較します。

## 検証環境と設定

今回は実際のEC2やバッチ基盤を作らず、CloudWatch LogsにJSON形式のテストログを投入しました。

| 項目 | 内容 |
|---|---|
| リージョン | ap-northeast-1（東京） |
| Log Group | `/poc/log-alarm-comparison`（Standardログクラス） |
| ログ形式 | JSON |
| 比較するもの | Metric Filter + Metric Alarm / Log Alarm |
| 通知 | 最初は設定せず、状態と履歴を確認 |

### エラー監視の設定値

検証①では、**「5分間でERRORが10件を超えたら検知」** を共通の監視要件とします。ただし、2つの方式は評価の仕組みが異なるため、設定値をそろえても評価タイミングまで同じになるわけではありません。

| 項目 | Metric Filter + Metric Alarm | Log Alarm | 意図・注意点 |
|---|---|---|---|
| 監視対象 | `InstanceId` Dimension | `by instanceId` | インスタンス別に判定する |
| 閾値 | `GreaterThanThreshold` / `10` | `GreaterThanThreshold` / `10` | **10件を超えるとALARM。10件ちょうどは対象外** |
| 集計 | `Sum` | `count(*)` | ERRORの件数を数える |
| 集計時間 | `Period=300` | `StartTimeOffset - EndTimeOffset = 300秒` | どちらも5分間の件数を対象にする |
| 実行間隔 | ― | `rate(5 minutes)` | Log Alarmはクエリの実行間隔を明示する |
| 評価条件 | `EvaluationPeriods=1` / `DatapointsToAlarm=1` | `QueryResultsToEvaluate=1` / `QueryResultsToAlarm=1` | 1回の閾値超過でALARMになるようにする |
| データ欠損 | `notBreaching` | `notBreaching` | ERRORが出ない場合は正常扱い。ただしログ停止は検知できない |

Metric Alarmは**メトリクスのデータポイント**、Log Alarmは**各回のクエリの集計結果**を使って判定します。今回は、1回の評価で閾値を超えたらALARMになる設定です。

### Log Alarmの実行間隔と検索範囲

Log Alarmでは、**何分ごとに実行するか**と、**いつのログを検索するか**をそれぞれ設定します。

今回は、5分ごとに実行し、その時点の7分前から2分前までのログを集計します。

| 設定 | 今回の値 | 意味 |
|---|---|---|
| 実行間隔 | `rate(5 minutes)` | 5分ごとに実行 |
| 検索範囲の開始 | `StartTimeOffset = 420秒` | 実行時刻の7分前 |
| 検索範囲の終了 | `EndTimeOffset = 120秒` | 実行時刻の2分前 |

例えば、**12:10の実行では12:03〜12:08、12:15の実行では12:08〜12:13**のログが対象です。

直近2分を外すのは、ログがCloudWatch Logsに届くまでの遅れを見込むためです。2分は今回の設定値であり、それ以上遅れて届くログは集計から漏れる可能性があります。実際の取り込み状況に合わせて調整します。

一方、Metric Alarmの`Period=300`は、メトリクスを5分単位で集計する設定です。**どちらも5分間のデータを使いますが、評価するタイミングは異なります。** 今回のスクリーンショットだけでは、どちらが早く検知したかまでは比較していません。

## 検証①：EC2ごとのエラー件数を監視する

例えば、複数のEC2からアプリケーションログを同じLog Groupに集約している環境を考えます。

監視条件は、**5分間で、1台でもERRORが10件を超えたら検知する**ことです。

ただし、全インスタンスのERRORを合計してしまうと、どのEC2が問題なのか分かりません。今回は`instanceId`ごとに判定します。

### テストログ

次の形式のJSONログを投入します。以下はログ形式の例であり、実際には後述の表にある件数分を投入します。

```json
{"eventType":"application","instanceId":"i-demo-001","level":"ERROR","message":"Connection timeout"}
{"eventType":"application","instanceId":"i-demo-002","level":"ERROR","message":"Database unavailable"}
```

同じ形式で、次の2段階に分けて投入します。

| ステップ | instanceId | ERROR件数 | 期待する判定 |
|---|---|---:|---|
| 1 | i-demo-001 | 2 | 閾値以下 |
| 1 | i-demo-002 | 15 | 閾値超過 |
| 1 | i-demo-003 | 1 | 閾値以下 |
| 2 | i-demo-004（新規） | 15 | 閾値超過 |

ステップ1で投入したログをLogs Insightsで集計し、3台分のERROR件数を確認しました。

![ステップ1：インスタンス別のERROR件数](/images/log-alarm-vs-metric-filter-alarm/02-sample-logs.png)

ステップ2は、**監視設定を変更せずに、新しいインスタンスを検知できるか**を確認するためのものです。

### Log Alarmで設定する

Logs Insights Queryでは、まず対象のログを絞り込みます。

```sql
fields @timestamp, eventType, instanceId, level
| filter eventType = "application" and level = "ERROR"
```

Aggregation Expressionでは、インスタンスごとに件数を数えます。

```text
count(*) by instanceId
```

`by`句を使うと、`instanceId`の値ごとに**Contributor**として独立に評価され、どれか1つでも閾値を超えるとアラームがALARMになります。

![Log Alarmのクエリと集計式](/images/log-alarm-vs-metric-filter-alarm/03-query-settings-detail.png)

閾値・実行間隔・Offsetは、前述の設定値の表に沿って設定します。

![Log Alarmの閾値と時間設定](/images/log-alarm-vs-metric-filter-alarm/04-threshold-schedule.png)

### Metric Filter + Metric Alarmで設定する

同じログを対象に、Metric Filterでは次のパターンを使います。

```text
{ $.eventType = "application" && $.level = "ERROR" }
```

メトリクス値は`1`、Dimensionには`InstanceId=$.instanceId`を指定します。作成したメトリクスに対して、5分間の合計値が10を超えたらアラームになるよう設定します。

![Metric FilterのDimension設定](/images/log-alarm-vs-metric-filter-alarm/05-metric-filter.png)

どちらの方式でも、インスタンスごとにERROR件数を集計できます。違いは、**新しいインスタンスが増えたときの設定**です。

今回のMetric Alarmは、インスタンスごとに1個ずつ作成します。`i-demo-004`のメトリクスは自動で生成されますが、異常を検知するには対応するアラームの追加が必要です。

なお、Metrics Insightsを使って複数のインスタンスをまとめて監視する方法もありますが、今回はインスタンス別にアラームを作る構成で比較します。

また、Dimensionを指定したMetric Filterでは、ERRORがない時間帯にデータが出ません。今回は`TreatMissingData=notBreaching`を指定し、データがない場合は正常として扱います。

### 検証結果
**① 既存のインスタンスを検知できたか**
Logs Insightsでログを手動集計すると、`i-demo-001`は2件、`i-demo-002`は15件、`i-demo-003`は1件でした。アラーム画面でも同じ値が表示され、**10件を超えた`i-demo-002`を両方式で検知できました。**

![i-demo-002を両方式で検知した結果](/images/log-alarm-vs-metric-filter-alarm/06-contributor-result.png)

Metric Alarmは`i-demo-002`だけがALARMとなり、残り2台はOKでした。Log AlarmもALARMとなり、Contributor欄に`instanceId = i-demo-002`が表示されています。

**② 新しいインスタンスを検知できたか**
次に、監視設定を変更せず、`i-demo-004`のERRORを15件投入しました。**Log Alarmでは新しいContributorとして認識され、ALARMになりました。**

![新しいインスタンスを検知したLog Alarm](/images/log-alarm-vs-metric-filter-alarm/11-new-contributor.png)

Metric Filter側でも、`i-demo-004`の`ErrorCount`メトリクスは生成されています。ただし、Metric Alarmは最初に作成した3台分だけで、`i-demo-004`に対応するアラームはありません。

![4台分のメトリクスと3台分のアラーム](/images/log-alarm-vs-metric-filter-alarm/12-list-metrics.png)

| 確認項目 | Metric Filter + Metric Alarm | Log Alarm |
|---|---|---|
| i-demo-002の異常 | 対応するアラームがALARM | 対応するContributorがALARM |
| i-demo-001 / 003 | 各アラームがOK | 件数は2件 / 1件で、ALARM中のContributorには表示されない |
| i-demo-004の追加 | メトリクスは自動生成。対応するアラームは未作成 | 設定変更なしでContributorとして検知 |
| 今回の監視設定 | Metric Filter 1個、Metric Alarm 3個 | Log Alarm 1個と自動作成されるScheduled Query |

今回の構成では、**インスタンスが増えたときにアラームを追加せずに済むこと**が、Log Alarmの分かりやすい違いでした。Metric Filterも新しいインスタンスのログを自動で集計しますが、インスタンス単位で作ったMetric Alarmは別途追加する必要があります。

## 検証②：バッチの処理時間を監視する

次は、成功したバッチの処理時間を監視します。`SUCCESS`で終了していても、処理が長引いていることはあります。そこで、ログの`durationMs`をジョブ別に集計し、5分（300,000ms）を超えたら検知する設定にします。

平均と最大の違いも見たいので、各ジョブを複数回実行した想定でログを投入します。

```json
{"eventType":"batch","job":"backup","status":"SUCCESS","durationMs":120000}
{"eventType":"batch","job":"backup","status":"SUCCESS","durationMs":110000}
{"eventType":"batch","job":"backup","status":"SUCCESS","durationMs":360000}
{"eventType":"batch","job":"cleanup","status":"SUCCESS","durationMs":30000}
{"eventType":"batch","job":"cleanup","status":"SUCCESS","durationMs":35000}
{"eventType":"batch","job":"export","status":"SUCCESS","durationMs":420000}
{"eventType":"batch","job":"export","status":"SUCCESS","durationMs":400000}
```

| job | 平均 | 最大 | `avg` > 300,000ms | `max` > 300,000ms |
|---|---:|---:|---|---|
| backup | 196,667ms | 360,000ms | 超過しない | 超過する |
| cleanup | 32,500ms | 35,000ms | 超過しない | 超過しない |
| export | 410,000ms | 420,000ms | 超過する | 超過する |

この表は、上のログがすべて同じ集計対象に入った場合の計算値です。`backup`は1回だけ5分を超えていますが、平均は5分未満です。**集計期間全体の平均を見るなら`avg`、1回でも遅い実行があったかを見るなら`max`** を使います。今回は両方を設定します。

### Log Alarmで設定する

```sql
fields @timestamp, eventType, job, status, durationMs
| filter eventType = "batch" and status = "SUCCESS"
```

Aggregation Expression：

```text
avg(durationMs) by job
```

```text
max(durationMs) by job
```

Aggregation Expressionは1つのアラームに1つしか指定できないため、`avg`と`max`はそれぞれ別のLog Alarmとして作成します。また、集計式で参照するフィールド（ここでは`durationMs`）がクエリ結果に含まれていない場合は、欠損データとして扱われます。

![平均処理時間を監視するLog Alarmの設定](/images/log-alarm-vs-metric-filter-alarm/07-batch-aggregation-1.png)

![最大処理時間を監視するLog Alarmの設定](/images/log-alarm-vs-metric-filter-alarm/07-batch-aggregation-2.png)

### Metric Filter + Metric Alarmで設定する

```text
{ $.eventType = "batch" && $.status = "SUCCESS" && $.durationMs = * }
```

`$.durationMs = *`で、`durationMs`が存在するログを対象にします。テストログでは、このフィールドに数値を入れています。Metric Valueに`$.durationMs`、Dimensionに`Job=$.job`を指定し、Metric Alarmの統計を`Average`または`Maximum`にします。

![Metric Filterの処理時間抽出設定](/images/log-alarm-vs-metric-filter-alarm/08-batch-metric-filter.png)

### 検証結果

Metric AlarmのCLI出力では、次の状態を確認できました。

![バッチ監視のMetric Alarmの状態と判定理由](/images/log-alarm-vs-metric-filter-alarm/09-batch-result.png)

| ジョブ | Averageの状態 | Maximumの状態 | 判定理由 |
|---|---|---|---|
| backup | OK | ALARM | Averageは欠損を正常扱い。Maximumは360,000msで超過 |
| cleanup | OK | OK | 両方とも欠損を正常扱い |
| export | ALARM | ALARM | Averageは410,000ms、Maximumは420,000msで超過 |

処理時間は、Log Alarmではログを直接集計し、Metric Filter方式ではメトリクスに変換して監視します。Metric Filterで作ったメトリクスは、ダッシュボードや他のアラームにも使えます。

:::message
今回の設定では、バッチの完了ログを使って処理時間を監視します。バッチが起動しなかった場合や、途中で止まって完了ログが出ない場合は検知できません。
:::

## 料金を比較するときのポイント

Log AlarmではCustom Metricを作らずに済みます。では、料金も安くなるのでしょうか。

比較するのは、主に**カスタムメトリクスとアラームの費用、定期クエリのスキャン費用**です。

| | Metric Filter + Metric Alarm | Log Alarm |
|---|---|---|
| カスタムメトリクス | 生成したメトリクス数（Dimensionの組み合わせ数）に応じた料金 | 不要 |
| アラーム | アラーム数に応じた料金 | アラーム料金 |
| Logs Insightsのスキャン | 監視自体では不要 | 定期クエリのスキャン量に応じた料金 |
| ログ取り込み・保存 | 両方式に共通 | 両方式に共通 |

Metric FilterのDimensionは、値の組み合わせごとに別のメトリクスになります。インスタンスが3台から30台になれば、カスタムメトリクスも3個から30個に増えます。

一方、Log Alarmを5分ごとに実行すると、30日間で約8,640回のクエリが実行されます。料金は、クエリでスキャンするログの量によって変わります。

今回は料金を実測していないため、どちらが安いかは未確認です。選ぶ際は、メトリクス数・アラーム数と、クエリのスキャン量をもとに費用を比較します。

料金の確認先：[Amazon CloudWatch 料金](https://aws.amazon.com/jp/cloudwatch/pricing/)

## 運用前に確認すること

今回の検証に加えて、運用前には次の点も確認する必要があります。

- Log Alarmでは、ログが届くまでの遅れを考えて検索範囲を決めます。今回は直近2分を外しましたが、この値は実際の取り込み状況に合わせて調整する必要があります。クエリの実行間隔も、次の実行までに処理が終わるように設定します。

- `by instanceId`の集計結果からインスタンスが消えると、そのContributorは欠損データの設定に関係なくOKに戻ります。ログが出ていないからといって正常とは限らないため、ログ収集の停止は別の方法で監視します。

- 監視対象が多い場合は、Contributorの上限にも注意が必要です。[公式ドキュメント](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/alarm-log.html)によると、2026年10月時点では、1回のクエリで返されるのは最大500件、同時にALARM状態として追跡されるのは最大100件です。今回は、この上限に達するケースは試していません。

- Metric Filterでは、Dimensionに指定する値の組み合わせが増えるほどメトリクス数も増えます。今回はインスタンスIDを使いましたが、リクエストIDのように毎回変わる値を指定すると、メトリクス数が増え、料金も高くなります。

## おわりに

今回は、同じログを使ってLog AlarmとMetric Filter + Metric Alarmを比較しました。Log Alarmでは、新しいインスタンスを追加しても、設定を変えずに閾値超過を検知できました。

ログから作ったメトリクスを継続して使いたいか、ログの集計結果を直接監視したいかによって、選び方も変わりそうです。

CloudWatch Logsを使った監視を検討する際に、この記事がご参考になれば幸いです。

## 参考資料

https://aws.amazon.com/jp/cloudwatch/pricing/
https://docs.aws.amazon.com/ja_jp/AmazonCloudWatch/latest/monitoring/alarm-log.html
https://docs.aws.amazon.com/ja_jp/AmazonCloudWatch/latest/logs/MonitoringLogData.html
https://docs.aws.amazon.com/ja_jp/AmazonCloudWatch/latest/logs/FilterAndPatternSyntax.html