---
title: Amazon CloudWatchの新機能「Log Analytics」を触ってみた
emoji: 📊
type: tech
topics:
  - aws
  - cloudwatch
  - loganalytics
  - monitoring
  - 初心者
published: false
date: "2026-07-06"
---

CloudWatch Logs Insightsを利用している方は、最近ログ分析画面が新しくなったことに気付いたのではないでしょうか。

AWSでは、新しいログ分析画面 **Amazon CloudWatch Log Analytics** の提供が開始されました。

従来よりも操作性が向上し、AIによるクエリ生成やサンプルクエリなど、ログ分析を始めやすい機能が追加されています。

本記事では、新しい Log Analytics の画面を見ながら、画面の変更点と便利な機能を紹介します。

---

## Log Analyticsとは？

Log Analytics は、CloudWatch Logsを分析するための新しいインターフェースです。

CloudWatchに保存されたログを検索・分析し、障害調査や運用監視に活用できます。

従来のCloudWatch Logs Insightsの機能を引き継ぎながら、より直感的にログ分析を行えるようになっています。

---

## 新しい画面を見てみよう

![新しいLog Analytics画面](/images/cloudwatch-log-analytics/home.png)

画面全体が整理され、ログ検索から分析までを一つの画面で操作できるようになりました。

また、右上には **ヘルプ** が追加され、初心者でも必要なクエリをすぐ利用できます。

---

## サンプルクエリを利用する

従来はLogs Insightsのクエリを自分で調べる必要がありました。

Log Analyticsでは、ヘルプ画面で用途に応じたサンプルクエリを選択するだけでログ分析を始められます。

![Help画面（サンプルクエリ）](/images/cloudwatch-log-analytics/help.png)

---

## クエリ履歴を利用する

![クエリ履歴画面](/images/cloudwatch-log-analytics/query-history.png)

実行したクエリは30日間保存されます。

障害調査で利用したクエリを毎回作り直す必要がなくなり、運用効率の向上につながります。

---

## Top N分析

![Top N画面](/images/cloudwatch-log-analytics/topn-rule.png)

Top Nでは、

- アクセス数が多いIP
- エラーが多いURL
- 利用回数が多いAPI

などを簡単に集計できます。

ログ全体の傾向を把握したい場合に便利です。

また、AWS WAFのログ分析にも対応しています。
![WAFログ分析画面](/images/cloudwatch-log-analytics/waf-log.png)

例えば、

- Blockされたアクセス
- Ruleごとのヒット件数
- 国別アクセス状況

などを可視化できます。

セキュリティ調査にも役立ちそうです。

---

## AIによるクエリ生成

個人的に特に便利だと感じた機能が、AIによるクエリ生成です。

自然言語で、「SecurityHubで特定製品の検出結果数を確認したい」のように入力すると、AIがLogs Insightsのクエリを生成してくれます。

![AI画面](/images/cloudwatch-log-analytics/ai-query-costomize.png)

Logs Insightsのクエリ構文に慣れていない方でも、簡単にログ分析を始められます。

---

## リアルタイム分析

Log Analyticsでは、リアルタイムでイベントを確認できます。

障害発生時の状況把握や、ログが流れている様子をその場で確認したい場合に便利です。

![リアルタイム分析](/images/cloudwatch-log-analytics/realtime-analytics.png)

---

## 分析結果をエクスポートできる

分析結果はCSV形式などでエクスポートできるため、調査結果をチームへ共有したり、後から分析内容を振り返ったりする際にも便利です。

![分析結果のエクスポート](/images/cloudwatch-log-analytics/result-export.png)

---

## 従来画面へ戻すことも可能

新しいUIにまだ慣れていない場合は、従来の画面へ戻すこともできます。
移行期間中でも安心して利用できます。

![旧画面へオプトアウト](/images/cloudwatch-log-analytics/back-to-old-home.png)

---

## 実際に触ってみた感想

今回実際に触ってみて感じたのは、「ログ分析を始めるまでのハードルが大きく下がった」という点です。

これまではクエリ構文を調べながら試行錯誤することが多かったですが、サンプルクエリやAIによるクエリ生成を利用することで、まずは「動かしてみる」ことが簡単になりました。

CloudWatchを使い始めたばかりの方でも、ログ分析に触れるきっかけとして使いやすいUIになったと感じます。

---

## まとめ

CloudWatch Log Analyticsでは、ログ分析をより手軽に始められる機能が多数追加されました。

- サンプルクエリ
- AIによるクエリ生成
- Top N分析
- ログの可視化
- クエリ履歴
- 分析結果のエクスポート

など、ログ分析をより効率的に行える機能が充実しています。

CloudWatch Logs Insightsに苦手意識があった方でも、新しいLog Analyticsを活用することで、これまでより手軽にログ分析を始められると感じました。

---

## 参考

- Amazon CloudWatch Log Analytics
  https://aws.amazon.com/about-aws/whats-new/2026/06/amazon-cloudwatch-log-analytics/
