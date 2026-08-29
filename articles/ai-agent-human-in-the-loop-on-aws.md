---
title: AI AgentにAWS操作をどこまで任せる？ ーHuman in the Loopで考える「責任範囲」の設計ー
emoji: 🤖
type: tech
topics:
  - bedrock
  - bedrock-agentcore
  - strands
  - ai-agent
  - security
published: false
date: "2026-08-30"
---

## はじめに

最近、Strands Agents や Amazon Bedrock AgentCore を触る機会があり、AI Agent から AWS API を呼び出して運用を支援する仕組みを試していました。

実際に作ってみると、EC2 や Security Group の情報取得だけでなく、設定変更まで比較的簡単に実装できます。

例えば、

> 「Security Group に 203.0.113.10/32 から HTTPS アクセスを許可してください。」

という指示に対して、Agent は現在の設定を確認し、必要であれば AWS API を呼び出して Security Group を更新できます。

ここまで試してみると、一つ疑問が浮かびました。

**AI Agent は AWS を操作できます。では、本番環境でもそのまま AI に任せてもよいのでしょうか。**

AWS を操作する Agent を作ること自体は、それほど難しくありません。

Tool を実装し、必要な IAM 権限を付与すれば、LLM は利用者の依頼内容に応じて Tool を選択し、Tool を通じて AWS API を実行できます。

しかし、実際の運用を考えると話は少し変わります。

例えば、EC2 の状態や Security Group の設定を取得するだけであれば、多少誤った回答を返したとしても AWS 環境そのものには影響しません。

一方で、Security Group の変更や EC2 の停止といった操作では、Agent の判断結果がそのまま AWS 環境へ反映されます。

つまり、**「情報を取得すること」と「設定を変更すること」では、同じ AWS API を利用する処理でも責任の重さが大きく異なります。**

最初は、「危険な操作を実行しないように System Prompt へ書いておけば十分ではないか」とも考えました。

しかし実際に Agent を実装してみると、それだけでは十分ではないことが分かりました。

Prompt は AI の振る舞いを誘導するものであり、AWS に対する権限そのものを制御する仕組みではありません。

そこで今回考えたのが、**「AI の判断」と「AWS API の実行」を分離する**という設計です。

具体的には、AI には変更内容の判断・提案までを任せ、実際に Write 操作を実行する前には人間が確認する、いわゆる **Human in the Loop** を組み込みました。

本記事では Security Group を題材とした小さな運用 Agent を実装しながら、

- Read 操作と Write 操作をどのように分けるのか
- Human in the Loop をどこへ組み込むのか
- 実際に動かしてみると何が見えてきたのか
- Production 環境を考えると、さらに何が必要になるのか

について紹介します。

本記事では、実際に PoC を通じて考えた、**「AI Agent に AWS 操作をどこまで任せるべきなのか」** という問いについて、一つの設計例としてまとめます。

## 今回作るもの

今回の検証では、Security Group を操作する小さな AI Agent を作成します。

利用できる機能は、次の 2 つだけです。

- Security Group の現在設定を取得する
- Security Group に新しい Inbound Rule を追加する

今回 Security Group を選んだ理由は、**Read 操作と Write 操作の違いを分かりやすく確認できる**ためです。

設定を取得するだけであれば AWS 環境は変更されませんが、Inbound Rule を追加すると実際に AWS 環境が変更されます。

同じリソースを対象にしながら、「情報取得」と「設定変更」という二つの操作を比較できるため、本記事の題材として採用しました。

## 今回のゴール

今回目指す構成は次のようなものです。

1. AI Agent が現在の Security Group を取得する
2. 変更が必要かどうか判断する
3. 変更内容を利用者へ提示する
4. 利用者が承認した場合のみ Write Tool を実行する
5. 変更後の状態を再確認する

```text
User
    │
    ▼
AI Agent
    │
    ├───────────────┐
    ▼               │
Read Tool           │
    │               │
    ▼               │
現在の状態を取得       │
    │               │
    ▼               │
変更内容を判断        │
    │               │
    ▼               │
Proposal            │
    │               │
    ▼               │
Human Approval      │
    │               │
    ▼               │
Write Tool──────────┘
    │
    ▼
AWS
    │
    ▼
Post Check
```

重要なのは、**AI が勝手に AWS を変更することではありません。** AI は、**「何を変更すべきか」** を判断します。

実際に AWS API を実行するかどうかは、人間が最終判断します。

さらに、変更後は Agent 自身が再度状態を取得し、期待どおりに設定が反映されたことまで確認します。

今回は、この一連の流れを小さな PoC として実装していきます。


## Agent はどのように判断するのか

今回の Agent には、

- Read Tool
- Write Tool

の二つだけを登録しています。

利用者が

> 「現在の Security Group を確認してください。」

と依頼した場合と、

> 「203.0.113.10/32 から HTTPS アクセスを許可してください。」

と依頼した場合では、Agent が利用する Tool は異なります。

今回の構成では、Tool を利用者が指定するのではなく、LLM が状況を判断して選択します。

例えば現在の設定を確認する依頼であれば、Read Tool を選択します。

一方、Rule の追加を依頼された場合は、まず現在の設定を取得し、その結果を踏まえて変更が必要かどうかを判断します。

変更が必要な場合のみ Write Tool を利用します。

これは従来の Python スクリプトとの大きな違いだと感じました。

通常の Automation では、どの API を呼び出すかはプログラムがあらかじめ決めています。

しかし Agent では、利用者の依頼内容や Tool の実行結果をもとに、**「次に何をするべきか」** を LLM 自身が判断します。

この柔軟性こそが Agent の特徴ですが、同時に **「その判断をどこまで自動的に AWS へ反映してよいのか」** を設計する必要があると感じました。

そこで今回は、Read 操作は自動で実行し、Write 操作だけ Human in the Loop を挟む構成を採用しました。

## Read Tool を実装する

まずは、現在の Security Group を取得する Read Tool を実装します。

今回利用した Tool は、

```python
describe_security_group
```

だけです。

内部では boto3 の

```python
describe_security_groups()
```

を呼び出し、Security Group の現在の設定を取得します。

コード自体は非常にシンプルで、Security Group ID を受け取り、現在の Inbound Rule を返すだけです。

今回重要なのは Tool の中身ではなく、**Read Tool は AWS 環境を変更しない**という点です。

そのため、今回の構成では Read Tool に対して Human Approval は行いません。

まずは事前準備として、今回検証に利用する Security Group の設定内容を確認します。

![Security Group の設定内容](/images/ai-agent-human-in-the-loop-on-aws/sg-before-set.png)

続いて、Agent の実行時に利用するパラメータを設定します。

今回はモデルとして **Claude Sonnet 4.5** を利用します。

![パラメータ設定内容](/images/ai-agent-human-in-the-loop-on-aws/parameter-set.png)

次はツールを実行します。

利用者が

> 現在の Security Group を確認してください。

と依頼すると、Agent は Read Tool を選択し、そのまま AWS API を実行します。

![Read Tool が自動実行される画面](/images/ai-agent-human-in-the-loop-on-aws/result-of-read-tool.png)

取得した結果はそのまま LLM へ渡され、現在の設定内容が自然言語で整理されて利用者へ返されます。

今回の PoC では、

```text
Read
  ↓
自動実行
```
という流れになります。

Read 操作のたびに Approval を求めてしまうと、運用支援 Agent としての利便性が大きく低下します。

一方で、「Read 操作だから常に安全」というわけではありません。

例えば、

- 機密情報を取得する Tool
- 大量の API を実行する Tool
- コストへ影響する Tool

などは、別の観点で制御が必要になる場合もあります。

今回は Security Group の設定取得という限定した用途であるため、Approval を不要としました。


## Write Tool を実装する

続いて、Security Group に新しい Rule を追加する Write Tool を実装します。

今回利用した Tool は、

```python
add_security_group_ingress
```

です。

内部では、

```python
authorize_security_group_ingress()
```

を呼び出しています。

Read Tool との違いは一つだけです。**AWS 環境を実際に変更する**という点です。

そのため、今回は Write Tool をそのまま実行するのではなく、Human in the Loop を組み込みました。

利用者から

> 203.0.113.10/32 から HTTPS アクセスを許可してください。

と依頼されると、Agent はまず現在の Security Group を取得します。
すでに同じ Rule が存在していれば、変更する必要はありません。変更が必要だと判断した場合だけ、Write Tool の実行へ進みます。

ただし、この時点ではまだ AWS API は呼び出されません。Human in the Loop によって、Agent は一度停止します。

![Human in the Loop によって停止した画面](/images/ai-agent-human-in-the-loop-on-aws/write-tool-before-input.png)

利用者には、実際に実行される変更内容が表示されます。

例えば、今回の PoC では、Security Group に新しい Inbound Rule を追加する前に、追加対象となる Security Group、Protocol、Port、送信元 IP アドレスなどを確認できます。

```text
Protocol       : TCP
Port           : 443
CIDR           : 203.0.113.10/32
Description    : add test
```

内容に問題がなければ **Approve（Y）** を選択します。Approve 後、Write Tool が実行され、Security Group が更新されます。

Agent はその後、自動的に Read Tool を実行し、期待どおり設定が反映されたことを確認します。

![Post Check 完了画面](/images/ai-agent-human-in-the-loop-on-aws/write-tool-approve.png)

最後に AWS Console でも Rule が追加されていることを確認しました。


![Security Group 更新後の画面](/images/ai-agent-human-in-the-loop-on-aws/sg-after-set.png)

今回の処理全体をまとめると、次のようになります。

```text
Read
  ↓
現在の状態を取得
  ↓
変更内容を判断
  ↓
Proposal
  ↓
Human Approval
  ↓
Write
  ↓
Post Check
```

単に Rule を追加するだけではなく、**変更前の確認 → 実行 → 変更後の確認**までを一連の流れとして実装しています。


## Human in the Loop は「確認画面」ではない

今回の PoC では、Write Tool を実行する直前に Human in the Loop を組み込みました。

動作だけを見ると、「実行前に Approve ボタンが表示される」というシンプルな仕組みに見えます。

しかし、実際に実装してみると、Human in the Loop の役割は単なる確認画面ではないことに気付きました。


### 最初に考えていた構成

最初は、次のようなシンプルな構成を考えていました。

```text
User
    │
    ▼
AI Agent
    │
    ▼
AWS API
    │
    ▼
AWS
```

利用者から依頼を受けると、Agent が Tool を選択し、そのまま AWS API を実行します。

PoC としては非常にシンプルで、実際に Security Group の更新も問題なく行えました。

技術的には、この構成でも十分動作します。

しかし、本番環境を考えると少し不安が残りました。


### Agent は自ら判断する

今回実装した Agent は、単純に Tool を呼び出しているわけではありません。

例えば、

> Security Group に 203.0.113.10/32 から HTTPS アクセスを許可してください。

と依頼された場合、Agent は最初から Write Tool を実行するわけではありません。

まず現在の Security Group を取得し、現在の状態を確認します。

その結果、変更が必要だと判断した場合だけ Write Tool を利用します。

つまり、Agent 自身が状況を確認し、**次に何をするべきか**を判断しています。

この点が、従来の Automation との大きな違いだと感じました。


### 判断できるからこそ、人が確認する

Agent が自ら判断できるのであれば、そのまま AWS API を実行してもよいのでしょうか。

私はそうは考えませんでした。

例えば、

- 利用者の意図を誤って解釈した場合
- 想定していない Tool を選択した場合
- Tool に誤ったパラメータを渡した場合

Tool 自体に問題がなくても、判断が誤っていれば、AWS 環境は変更されてしまいます。

そのため今回の PoC では、Write Tool を実行する直前で、必ず人間が確認するようにしました。

```text
User
    │
    ▼
AI Agent
    │
    ▼
Proposal
    │
    ▼
Human Approval
    │
    ▼
Write Tool
    │
    ▼
AWS
```

この構成では、AI は変更内容の判断・提案までを担当します。

実際に AWS API を実行するかどうかは、人間が最終判断します。

一方で、利用者は Approve(Y) だけでなく Reject(N) を選択することもできます。

![Reject（N）をテストする画面](/images/ai-agent-human-in-the-loop-on-aws/reject-test.png)

Reject(N) を選択した場合、Write Tool は実行されず、Security Group の設定も変更されません。

![Reject（N）を選択した画面](/images/ai-agent-human-in-the-loop-on-aws/reject-unapprove.png)

Human in the Loop の目的は、「必ず実行すること」ではなく、「最終的な判断を人間が行うこと」にあります。

---

今回の PoC では、もう一つ試したことがあります。

それは、`0.0.0.0/0` のような広いアクセス許可を追加しようとした場合です。

Agent は要求どおりに Tool を実行するのではなく、「この設定はリスクが高い可能性があります」という内容を利用者へ提示しました。

![0.0.0.0/0 を追加しようとした際の Risk 提示](/images/ai-agent-human-in-the-loop-on-aws/risk-test.png)

最終的には、利用者が内容を確認したうえで **Reject（N）** を選択し、変更は実施していません。

![Risk 提示後に Reject を選択した画面](/images/ai-agent-human-in-the-loop-on-aws/high-risk-unapprove.png)

今回の PoC では単純なルールベースによる判定ですが、重要なのは、Agent が変更内容を提案し、人間が最終判断を行うという役割分担です。

Human in the Loop は、AI の判断をそのまま実行するのではなく、必要に応じて人が介入できる境界として機能します。


## Human in the Loop が担う役割

今回実装して分かったことがあります。

Human in the Loop は、AI を止めるための機能ではありません。

また、単なる確認ダイアログでもありません。

Human in the Loop によって作られるのは、**AI の判断と AWS API の実行を分離するための境界**です。

もしこの境界がなければ、AI が判断した内容は、そのまま AWS 環境へ反映されます。

一方で Human in the Loop を入れることで、

- AI は変更内容を提案する
- 人間が最終的に実行を判断する

という役割分担が明確になります。

今回の PoC は小さな構成ですが、この考え方は Security Group だけでなく、

- EC2
- IAM
- CloudFormation
- RDS

など、さまざまな運用シナリオへ応用できると感じました。


## Production環境を考える

最初は、Human in the Loop は「危険な操作を防ぐための機能」という程度の認識でした。

しかし、実際に Agent を作ってみると、本当の役割は少し違いました。

重要なのは、AI を止めることではありません。

**AI にどこまで責任を持たせるのかを設計すること**です。

今回の PoC では、Read 操作は Agent が自動実行し、Write 操作だけ人間が判断する構成にしました。

これは AI を信用していないからではありません。

Read と Write では、AWS 環境へ与える影響が異なるからです。

Human in the Loop は、その違いを設計へ反映するための仕組みだと感じました。


### Read と Write だけで十分なのか

今回の PoC では、分かりやすさを優先し、

- Read 操作
- Write 操作

の二つに分類しました。

Read は AWS 環境を変更しないため自動実行し、Write は Human Approval を経由して実行する構成です。

PoC としては十分ですが、実際の運用ではもう少し細かく考える必要があります。

例えば、Write 操作と一言で言っても、その影響範囲はさまざまです。

- EC2 にタグを追加する
- Auto Scaling の Desired Capacity を変更する
- Security Group を変更する
- IAM Policy を変更する
- 本番環境のリソースを削除する

これらはすべて Write 操作ですが、リスクは同じではありません。

そのため Production 環境では、Read / Write の二分類だけではなく、操作内容に応じて責任範囲を分けることも考えられます。

例えば次のような分類です。

|レベル|操作例|実行方法|
|---|---|---|
|Low|状態取得、ログ確認|自動実行|
|Medium|Tag 更新、軽微な設定変更|Human Approval|
|High|Security Group、IAM、EC2 停止|明示的な承認|
|Critical|削除、権限変更など|Agent からは実行しない|

今回の PoC は、この考え方を最もシンプルな形で表現したものです。

つまり、**「AWS 環境を変更する操作には Human Approval を入れる」** という設計になります。

もちろん、環境や運用ルールによって分類方法は変わります。

重要なのは、**「何が Read か、何が Write か」ではなく、「どの操作を AI に任せるか」を設計すること**だと考えています。

### Production 環境では Human in the Loop だけでは足りない

ここまでで、

- AI が変更内容を判断する
- Human Approval を行う
- Write Tool を実行する

という流れを実装できました。

PoC としては期待どおりの動作です。

しかし、本番環境を考えると、Human in the Loop を導入しただけでは十分とは言えません。

Human Approval は、**「実行してよいかを確認する仕組み」**です。

一方、**「Agent が何を実行できるか」** は、Tool や IAM によって決まります。

つまり、Approval があることと、安全であることは同じではありません。

Production 環境では、Human in the Loop に加えて、Agent を実行する基盤や監視、認証・認可なども含めて設計する必要があります。

そこで一例として、今回の PoC を AWS 上へ展開した場合の構成を考えてみます。

ローカル環境で実装した PoC と比較すると、Production 環境では運用やセキュリティに関するコンポーネントが追加されます。

![Production環境の構成](/images/ai-agent-human-in-the-loop-on-aws/human-in-the-loop-production.png)

PoC から Production へ展開するにあたり、主に次のコンポーネントを追加しています。

- Amazon Bedrock AgentCore Runtime
- Amazon API Gateway
- AWS Lambda
- Amazon CloudWatch
- Amazon Bedrock AgentCore Observability
- AWS IAM

ただし、重要なのは、AgentCore Runtime を利用したからといって、安全なAgentになるわけではないという点です。

AgentCore Runtime は Agent を実行・運用するための基盤であり、Human in the Loop や IAM による最小権限設計、Tool の責任範囲を置き換えるものではありません。

これらを組み合わせて初めて、Production 環境で利用できる構成に近づくと考えています。


### Tool にも責任範囲を持たせる

Human in the Loop によって、「実行するかどうか」は人が判断できるようになりました。

しかし、Production 環境ではそれだけでは十分ではありません。

Agent が実際に利用できる Tool 自体にも、責任範囲を持たせる必要があります。

今回の PoC では、Tool を次のように分けました。

```text
describe_security_group

add_security_group_ingress
```

一見すると当たり前のように見えますが、この設計にも意味があります。

例えば、一つの Tool が

- EC2 の停止
- Security Group の変更
- IAM Policy の更新
- S3 Bucket の削除

まで実行できるようになっていたらどうでしょうか。

Agent が誤ってその Tool を利用した場合、一度に影響を与えられる範囲が大きくなります。

そのため、**一つの Tool は一つの責任だけを持つ**という設計の方が分かりやすく、安全性も高めやすくなります。

例えば Security Group であれば、

```text
describe_security_group

add_security_group_ingress

remove_security_group_ingress
```

のように、操作ごとに Tool を分割することもできます。

Tool を細かく分けることで、Agent が利用できる操作そのものを限定できます。

つまり、Tool もまた、**AI が操作できる範囲を制御する境界**になります。


### IAM は最後の境界になる

Tool が AWS API を呼び出す以上、IAM の設計も重要です。

例えば、Agent に AdministratorAccess を付与した場合、Tool の実装次第では非常に広い AWS 操作が可能になります。

Human Approval を導入していたとしても、Agent が持つ IAM 権限そのものは変わりません。

そのため、IAM についても通常の AWS アプリケーションと同じように、**最小権限の考え方**が重要になります。

今回の Security Group Agent であれば、必要なのは Security Group を取得・更新するための権限だけです。不要な権限まで付与する必要はありません。

今回の構成をまとめると、

```text
Human Approval
        │
        ▼
Tool
        │
        ▼
IAM
        │
        ▼
AWS API
```

という複数の境界を設けています。

- Human Approval は「実行するか」を判断する
- Tool は「何を実行できるか」を限定する
- IAM は「実際に実行できる AWS API」を制限する

どれか一つだけに依存するのではなく、複数の制御を組み合わせることが重要だと考えています。


### Agent を「作る」ことと「運用する」ことは別

今回の PoC はローカル環境で実装しました。

ローカル環境では、Agent がどのように判断したのか、どの Tool を実行したのか、ターミナルを確認するだけで把握できます。

しかし、Production 環境では事情が変わります。

例えば、利用者から

> 「Agent が意図しない提案をした」

という問い合わせがあった場合、最終的な回答だけでは原因を特定できません。

確認したいのは、

- Agent がどのような処理を実行したのか
- どの Tool を選択したのか
- Tool にどのようなパラメータを渡したのか
- Tool からどのような結果が返ってきたのか
- Human Approval の前後で何が行われたのか

といった実行履歴です。

つまり、**Agent を作ることと、Agent を運用することは別の課題**になります。

Agent が複数の Tool を利用し、自律的に処理を行うようになるほど、運用時に追跡できる情報の重要性はさらに高くなります。

---

### AgentCore Runtime / Observability をどう考えるか

今回の記事では、Strands Agents をローカル環境で動作させ、Agent の責任範囲について検証しました。

一方で、Production 環境を考えると、「Agent をどのように実行するか」だけでなく、「Agent をどのように運用するか」という視点も重要になります。

例えば、利用者から

> 「Agent が想定とは異なる提案をした」

という問い合わせがあった場合、

最終的な回答だけでは十分ではありません。

確認したいのは、

- Agent がどのような処理経路をたどったのか
- どの Tool を選択したのか
- Tool にどのようなパラメータを渡したのか
- Tool からどのような結果が返ってきたのか
- Human Approval の前後でどのような処理が行われたのか
- エラーや遅延がどこで発生したのか

といった実行状況です。

Agent が複数の Tool を利用して自律的に処理を行うようになるほど、このような情報を追跡できることが重要になります。

そこで、Production 環境では Amazon Bedrock AgentCore Runtime や Observability のような実行・運用基盤も選択肢になります。

例えば AgentCore Runtime を利用することで、Agent を継続的に実行するためのランタイムとして利用できます。

また、Observability を利用すると、

- Tool の呼び出し履歴
- Trace 情報
- Agent の実行状況
- モデル実行時間
- エラー情報

などを確認しやすくなります。

ただし、AgentCore Runtime や Observability は、Human in the Loop の代わりになるものではありません。

それぞれ役割が異なります。

```text
Human in the Loop
    └─ AI が実行するかどうかを判断する境界

Tool
    └─ AI が利用できる操作を限定する境界

IAM
    └─ AWS API の実行範囲を制御する境界

Runtime
    └─ Agent を実行する基盤

Observability
    └─ Agent の実行状況を追跡・監視する仕組み
```

つまり、Production 環境では、Human in the Loop だけでも、IAM だけでも十分ではありません。

それぞれの役割を組み合わせることで、初めて運用できる Agent に近づいていくと考えています。

---

## 今回の構成を整理する

今回検証した構成をまとめると、次のようになります。

```text
                      ┌─────────────────┐
                      │      User       │
                      └────────┬────────┘
                               │
                               ▼
                      ┌─────────────────┐
                      │    AI Agent     │
                      └────────┬────────┘
                               │
                ┌──────────────┴──────────────┐
                │                             │
             Read Tool                    Write Tool
                │                             │
                │                      Human Approval
                │                             │
                ▼                             ▼
             AWS API                      AWS API
                │                             │
                └──────────────┬──────────────┘
                               ▼
                              AWS
                               │
                               ▼
                          Post Check
```

今回の PoC は非常に小さな構成ですが、実際の Production 環境でも考え方は変わらないと感じています。

重要なのは、AI にどこまで任せるかではなく、**どこで責任を分けるか**を設計することです。


# まとめ

今回の検証を始めたときは、「Write Tool の前に Human Approval を入れれば十分だろう」という程度に考えていました。

しかし実際に Agent を実装してみると、重要なのは Approval 機能そのものではありませんでした。

本質的な問いは、**AI Agent にどこまで責任を持たせるべきなのか**ということです。

今回の PoC では、

- Read は Agent が自動で実行する
- Agent が変更内容を判断する
- Write の前には Human Approval を行う
- Tool の責任範囲を限定する
- IAM を最小権限で設計する
- 実行後は Post Check を行う

という構成を採用しました。

もちろん、これが唯一の正解ではありません。

環境やシステムによって、AI に任せられる範囲は変わります。

しかし、AI Agent が AWS API を直接利用できるようになった今、

重要なのは **「何ができるか」** ではなく、**「どこまで任せるか」** を設計することだと考えています。

Agent の性能は今後さらに向上し、より多くの AWS 操作を自律的に実行できるようになるでしょう。

その一方で、Human in the Loop、Tool 設計、IAM、Observability といった**責任を分離するための設計**は、今後も変わらず重要であり続けるはずです。

今回の PoC が、AI Agent を AWS 運用へ組み込む際の一つの設計例として、参考になれば幸いです。
