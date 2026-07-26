---
slug: aws-network-firewall-new-default-action
title: AWS Network Firewallの新しいデフォルトアクション「Application Drop Established」とは？
authors: [song]
tags:
  - aws
  - networkfirewall
  - security
  - firewall
---

## はじめに

こんにちは、宋です。

AWS Network Firewall の Firewall Policy を確認していると、Stateful Rule の Default Action に **「確立されたアプリケーションドロップ（サーバー指向のみ）」** という新しい選択肢が追加されていました。

以前から利用できた

- 確立された接続のパケットをドロップ
- 確立されたアプリケーションドロップ（双方向）

に加えて、新しい Default Action が利用できるようになっています。

名前だけでは違いが分かりづらく、

- 従来の Default Action と何が違うのか
- なぜ新しい Action が追加されたのか
- どのような影響があるのか
- 既存環境でも変更した方がよいのか

気になったので、AWS の公式ドキュメントをもとに整理してみました。

## AWS Network Firewallとは

AWS Network Firewall は、Amazon VPC 内を流れる通信を検査・制御するフルマネージド型のネットワークファイアウォールサービスです。

通信は **ステートレスルール** と **ステートフルルール** の2段階で評価されます。

![AWS Network Firewall の全体構成](/images/aws-networkfirewall-new-default-action/network-firewall-overview.png)

まずパケット単位でステートレスルールが評価され、その後必要に応じてステートフルルールによる詳細な検査が実施されます。

## ステートレスルールとステートフルルール

それぞれの役割を簡単に整理すると次のようになります。

|項目|ステートレスルール|ステートフルルール|
|------|----------------|----------------|
|評価単位|Packet|Flow|
|通信状態(State)|保持しない|保持する|
|HTTP/TLS|×|〇|
|Suricata Rule|×|〇|

今回紹介する **Application Drop Established**（確立されたアプリケーションドロップ （サーバー指向のみ））は、ステートフルルールで利用する Default Action の一つです。

なお、本記事の内容は Firewall Policy の **Strict Order（厳密な順序）** を利用する場合の Default Action を対象としています。

## 通信はどのように評価されるのか

通信は次のような流れで評価されます。

1. ステートレスルールで評価
2. 必要に応じてステートフルルールへ転送
3. ステートフルルールで通信内容を評価
4. ステートフルルールで Pass ルールに一致しない場合は、Default Action を適用
   
![パケット評価の流れ](/images/aws-networkfirewall-new-default-action/packet-flow.png)

つまり、**Default Action は最後に適用される動作**となります。

## Default Actionとは

AWSマネジメントコンソールでは **「ステートフルルール評価の順序とデフォルトのアクション」** として設定できます。

![ステートフルルール評価の順序とデフォルトのアクション](/images/aws-networkfirewall-new-default-action/default-action-console.png)

現在選択できるドロップアクションは以下のとおりです。

- 確立されたアプリケーションドロップ（サーバー指向のみ）
- 確立されたアプリケーションドロップ（双方向）
- 確立された接続のパケットをドロップ
- すべてをドロップ

## 3つのDefault Actionの違い

今回比較したいのは次の3つです。

|Default Action|概要（overflow）|
|--------------------------|-----------------------------|
|確立された接続のパケットをドロップ|TCPセッション確立後の通信を対象に評価|
|確立されたアプリケーションドロップ（双方向）|クライアント・サーバー双方のアプリケーション通信を評価|
|確立されたアプリケーションドロップ（サーバー指向のみ）|クライアントからサーバーへの通信を評価|


### Default Actionの詳細比較
| 比較項目 | 確立された接続のパケットをドロップ | 確立されたアプリケーションドロップ（双方向） | 確立されたアプリケーションドロップ（サーバー指向のみ） |
| :--- | :---: | :---: | :---: |
| **Default Action の適用方向** | Client ⇄ Server | Client ⇄ Server | **Client → Server のみ** |
| **評価対象** | TCP セッション | アプリケーション層（双方向） | アプリケーション層（Client → Server） |
| **Server → Client の TCP 制御パケット**<br>（Window Update / Keep-alive / RST など） | 通過 | Drop 対象となる場合あり | **通過** |
| **Server → Client の正常な通信**<br>（サーバーバナー、レスポンスなど） | 通過 | Drop 対象となる場合あり | **通過** |
| **特徴** | TCP セッション単位で評価 | 双方向のアプリケーション通信を評価 | Client → Server の通信のみを評価し、Server → Client の正常な通信を維持 |
| **新規 Firewall Policy のデフォルト** | - | - | ◯ |


### ３つのDefault Actionの動作イメージ

![3つのDefault Action比較](/images/aws-networkfirewall-new-default-action/default-action-comparison.png)


## なぜ「サーバー指向のみ」が追加されたのか

ここが今回一番気になったポイントです。

従来の **「確立されたアプリケーションドロップ（双方向）」** では、ステートフルルールに一致しなかった通信について、クライアントからサーバーへの通信だけでなく、サーバーからクライアントへの通信も Default Action の対象になります。

そのため、アプリケーション通信そのものとは別に、サーバーから送信される以下のような正常なパケットまでドロップ対象となる場合がありました。

- TCP Window Update
- TCP Keep-alive
- TCP Reset（RST）
- FTP、SMTP、SSH などのサーバー起点のバナー
- 許可されたアプリケーションリクエストに対するサーバーのレスポンス

これらのパケットがドロップされると、ルール上は通信を許可しているにもかかわらず、接続が途中で切断されたり、断続的に通信が失敗したりする可能性があります。

そこで追加されたのが、**「確立されたアプリケーションドロップ（サーバー指向のみ）」** です。

このアクションでは、確立済み接続のうち、ステートフルの Pass ルールに一致しなかった **Client → Server 方向の TCP/IP 通信のみ** をドロップ対象とします。

一方、**Server → Client 方向の TCP/IP 通信は、この Default Action ではドロップされません。**

これにより、Server → Client の正常な TCP/IP 通信を維持しながら、Client → Server の通信に対して Default Action を適用できるようになりました。

その結果、従来の双方向アクションで発生する可能性があった意図しない通信断を抑え、アプリケーションの可用性向上が期待できます。

## 新しい Default Action をどう理解すればよいか

最初は、 **「サーバー指向のみ」と聞くと、双方向より検査範囲が狭くなったのでは？** と思いました。

しかし実際には、単純に検査機能を減らしたものではありません。

従来の双方向アクションでは、Server → Client 方向の TCP 制御パケットやサーバーレスポンスまで Default Action の影響を受ける可能性がありました。

新しいアクションでは、Default Action のドロップ対象を Client → Server 方向に限定することで、アプリケーション検査を維持しながら、正常なサーバー応答や TCP の接続制御を妨げにくくしています。

つまり、 **検査対象を一方的に減らしたというより、Default Action による過剰なドロップを防ぎ、通信の安定性を高めるための改善** と理解すると分かりやすいと思います。

AWS は、新しく作成する Firewall Policy のデフォルトを、従来の「双方向」から「サーバー指向のみ」へ変更しています。

従来の双方向アクションによって、Window Update、Keep-alive、RST などの正当な Server → Client パケットがドロップされ、原因を特定しにくい断続的な接続障害が発生する可能性があったためです。

## 既存環境は変更したほうがよい？

今回の変更は、新しく作成する Firewall Policy のデフォルト値に関するものです。

現在「確立されたアプリケーションドロップ（双方向）」を利用していて問題が発生していない環境では、必ずしも変更が必要というわけではありません。

一方で、

- 接続が断続的に切断される
- TCP Keep-alive や RST が影響している可能性がある

といった事象がある場合には、「確立されたアプリケーションドロップ（サーバー指向のみ）」への変更を検討する価値があります。

設定変更を行う際は、検証環境で十分に動作確認した上で本番へ適用することをおすすめします。


## まとめ

今回は、AWS Network Firewall に追加された **「確立されたアプリケーションドロップ（サーバー指向のみ）」** について整理しました。

ポイントは次のとおりです。

- Strict Order の Stateful Rule で利用する Default Action
- Client → Server の TCP/IP 通信のみをドロップ対象とする
- Server → Client の TCP 制御パケットやレスポンスは維持される
- 新規 Firewall Policy ではデフォルトで利用される

「サーバー指向のみ」という名称だけを見ると、サーバーからクライアントへの通信を評価する機能のようにも見えます。

実際には、Default Action のドロップ対象を Client → Server 方向に限定し、Server → Client 方向の正常な通信を維持するためのアクションです。

特に、TCP 制御パケットやサーバー起点のバナーを利用するプロトコルで、従来の双方向アクションによる意図しない通信断が発生している場合に有効な選択肢となります。

AWS Network Firewall の Default Action を設計・変更する際は、単に推奨設定へ切り替えるだけではなく、既存の Pass ルールや利用プロトコルへの影響を確認したうえで適用することが重要です。

AWS Network Firewall を設計・運用する際の参考になれば幸いです。

## 参考資料

https://docs.aws.amazon.com/ja_jp/network-firewall/latest/developerguide/suricata-rule-evaluation-order.html

https://aws.amazon.com/jp/about-aws/whats-new/2026/06/aws-network-firewall-updates-default-drop-action/

https://aws.amazon.com/network-firewall/

http://docs.aws.amazon.com/ja_jp/network-firewall/latest/developerguide/firewall-rules-engines.html