---
title: "AI Agentの処理は成功したのに、また実行？AgentCore × Lambda Durable Functionsで再実行を検証する"
emoji: "🔁"
type: "tech"
topics:
  - aws
  - lambda
  - bedrock
  - agentcore
  - serverless
published: false
date: "2026-10-25"
---

## はじめに
AI Agentに設定情報を調べてもらい、その結果をS3に保存する。そんな処理を作っていると、少し気になることがあります。

**Agentの分析は終わっているのに、その後のS3保存だけ失敗したらどうなるんだろう？**

処理を最初からやり直すと、Agentの分析も再実行されます。Agentの場合、モデルだけでなく内部のToolも再度呼び出される可能性があり、処理時間や料金、更新処理の重複が気になるところです。

そこで今回は、**Amazon Bedrock AgentCore Runtime × AWS Lambda Durable Functions**を使い、S3保存に失敗した場合の再実行動作を、通常のLambdaと比較してみました。

今回の検証では、通常のLambdaはAgentCoreを2回呼び出したのに対し、Durable Functionsでは完了済みのAgent処理を再実行せず、S3保存だけを再試行できました。

ただし、Durable Functionsですべての重複実行を防げるわけではありません。その仕組みと適用範囲も確認します。

## 本記事の対象者

- LambdaからAI Agentを呼び出す処理を作っている方
- AgentやToolの重複実行が気になっている方
- Lambda Durable FunctionsのStepとCheckpointを理解したい方

## 今回の検証構成

今回は、LambdaからAgentCore Runtime上のStrands Agentを呼び出し、分析結果をS3に保存する構成を用意しました。

AgentにはAmazon Nova Liteを使用し、Python Toolで取得したEC2の模擬設定を分析させます。実際のEC2 APIは呼び出しません。

![今回の検証構成](/images/agentcore-lambda-durable-retry/00-architecture.png)

処理は次の2段階です。

1. **Agent実行**：AgentCore RuntimeでEC2の模擬設定を分析する
2. **S3保存**：Agentの分析結果をS3に保存する

S3保存時には、初回だけ**PutObjectの直前に意図的なエラー**を発生させます。実際のS3サービスの障害ではなく、コードによる失敗注入です。

この条件で、以下の2方式を比較します。

| | Ordinary Lambda | Durable Lambda |
|---|---|---|
| 処理方法 | 通常の関数処理 | Agent実行とS3保存を別々のStepで実行 |
| 失敗時 | 処理全体を再試行 | Retryを設定したS3保存Stepのみ再試行 |
| Agentの再実行 | あり | なし（完了済みStepを再利用） |

※ Ordinary Lambdaは比較のため、処理全体を再試行するように実装しています。通常のLambdaが必ずこの動作になるわけではありません。

## StepとCheckpointによる再実行の違い

![Ordinary LambdaとDurable Lambdaの再試行範囲](/images/agentcore-lambda-durable-retry/00-retry-comparison.png)

Durable Functionsでは、Stepが正常に完了すると、その結果がCheckpointに記録されます。

今回の構成では、Agent実行とS3保存を別々のStepにしています。そのため、S3保存に失敗しても、**Checkpointに記録されたAgentの分析結果を再利用し、S3保存Stepだけを再試行**できます。

ただし、Checkpointが記録される前に失敗した処理や、Agent内部のTool実行まで重複を防げるわけではありません。

この違いを、まずMock Agentで確認し、その後、実際のAgentCore Runtimeを使って検証します。


## 検証環境

| 項目 | 内容 |
| --- | --- |
| Region | 東京（ap-northeast-1） |
| 構築 | AWS SAM（Lambda / S3 / DynamoDB）、AgentCore CLI（Runtime） |
| Lambda | Python 3.14、通常Lambda / Durable Lambda |
| Agent | AgentCore Runtime + Strands Agents |
| モデル | Amazon Nova Lite |
| Tool | 模擬EC2設定の取得（実EC2への操作なし） |
| 記録 | CloudWatch Logs、DynamoDB、Durable Execution History |

まずMock Agentでリトライの挙動を確認し、その後、実際のAgentCore Runtimeに切り替えて同じ条件で試しました。

![SAMで作成した検証リソース](/images/agentcore-lambda-durable-retry/01-cloudformation.png)

Durable側では `live` エイリアスを使用しています。

![Durable Lambdaとエイリアス](/images/agentcore-lambda-durable-retry/02-durable-config.png)

## どう実装したか

### Ordinary Lambda：あえて最初からやり直す

比較用の通常Lambdaは、全体を最大2回試す構成です。次のコードは要点を抜き出しています。

```python
for whole_attempt in (1, 2):
    try:
        agent_result = call_agent(run_id, 'ordinary', prompt)
        saved = save_result(run_id, 'ordinary', agent_result, fail)
        return {
            'status': 'completed',
            'workflow_attempt': whole_attempt,
            'saved': saved,
        }
    except RuntimeError:
        if whole_attempt == 2:
            raise
```

S3保存で例外が出ると、次のループで `call_agent()` から実行し直します。

### Durable Lambda：処理をStepに分ける

Durable側は `invoke_agent` と `save_to_s3` の2つのStepに分けました。

```python
@durable_step
def invoke_agent(step_context, run_id: str, prompt: str):
    return call_agent(run_id, 'durable', prompt)

@durable_step
def save_to_s3(step_context, run_id: str, result: dict, fail: bool):
    return save_result(run_id, 'durable', result, fail)

@durable_execution
def handler(event, context):
    run_id = event['run_id']
    prompt = event['prompt']
    result = context.step(invoke_agent(run_id, prompt), name='invoke_agent')
    saved = context.step(
        save_to_s3(run_id, result, event.get('inject_failure', True)),
        name='save_to_s3',
        config=save_retry,
    )
    return {'status': 'completed', 'saved': saved}
```

`save_retry` は最大2回試行、2秒の固定間隔という設定です。Agent Stepが完了したあとにS3 Stepが失敗した場合、Durableの実行履歴から完了済みStepの結果を復元して続きから処理できます。正確には、復旧時にコード自体のReplayは行われますが、完了したStepの副作用をもう一度実行するのではなく、保存済みの結果が利用されます。

### 失敗の入れ方と回数の記録

両方のLambdaで同じ `save_result()` を使用し、最初の試行時だけ失敗させています。
比較の各ラウンドでは新しい run_id を使い、そのラウンドのOrdinaryとDurableには同じ値を渡します。

```python
attempt = increment(run_id, kind, 'save_attempts')
if fail and attempt == 1:
    raise RuntimeError('Injected failure before S3 PutObject')

S3.put_object(...)
```

DynamoDBには `run_id#ordinary#agent_calls` のようなキーで、Agent呼び出し関数に入った回数とS3保存を試みた回数を記録しています。**この回数はアプリケーション側の計数**であり、モデルへの課金リクエスト数と同じとは限りません。

## ① まずはMock Agentで確認

AgentCoreを呼び出す前に、簡単なMock応答を返すモードで動きを確かめました。

通常Lambdaのログでは、初回の `SAVE_ATTEMPT` に続いて `INJECTED_FAILURE` が発生し、その後もう一度 `AGENT_CALL` が記録されています。

![通常LambdaのMock実行ログ](/images/agentcore-lambda-durable-retry/03-ordinary-logs.png)

一方、Durable LambdaはAgent呼び出しが1回、保存試行が2回でした。

![Durable LambdaのMock実行ログ](/images/agentcore-lambda-durable-retry/04-durable-logs.png)

Durable Executionの画面を見ると、`invoke_agent` は成功済みのまま、`save_to_s3` が失敗後に1回再試行され、最終的に `ExecutionSucceeded` となっています。

![MockでのDurable Execution Timeline](/images/agentcore-lambda-durable-retry/05-durable-timeline.png)

DynamoDBの計数も一致しました。

| Mock実験 | Ordinary | Durable |
| --- | ---: | ---: |
| Agent呼び出し | 2回 | 1回 |
| S3保存試行 | 2回 | 2回 |

![Mock実験のDynamoDB計数](/images/agentcore-lambda-durable-retry/07-call-counts.png)

S3に保存したJSONでも、結果に含めた `call_number` がOrdinaryは2、Durableは1となっていました。

![Mock実験のS3保存結果](/images/agentcore-lambda-durable-retry/08-s3-results.png)

ここまででStep単位のリトライが動くことは確認できました。ただしMockにはモデル推論もTool呼び出しもありません。次に、実際のAgentCoreで同じことが起きるか試します。

## ② 実際のAgentCore Runtimeでも試す

今回のAgentは、模擬EC2インスタンスのSecurity Group、パブリックIP、IMDSv2、EBS暗号化などをToolで取得し、Nova Liteで日本語のセキュリティ所見をまとめるものです。

AgentCore Runtimeのデプロイと、`DEFAULT` エンドポイントの準備完了を確認しました。

![AgentCore Runtimeの詳細](/images/agentcore-lambda-durable-retry/09-agentcore-runtime.png)

Runtimeのログでは、`AGENT_START` → `TOOL_CALL` → `AGENT_COMPLETED` の流れを確認できました。ログ収集の都合で同じイベントが二重に表示されている行もあるため、単純なログ行数をTool実行回数として数えないようにしています。

![AgentCoreのTool呼び出しログ](/images/agentcore-lambda-durable-retry/10-agentcore-tool-logs.png)

### S3保存失敗を再現

今度はOrdinaryとDurableに同じ日本語Promptを送り、`inject_failure: true` で初回保存前にエラーを発生させました。

Ordinary側のログは次の順序でした。

1. `AGENT_CALL`（1回目）→ `AGENTCORE_SUCCESS`
2. `SAVE_ATTEMPT`（1回目）→ `INJECTED_FAILURE`
3. `AGENT_CALL`（2回目）→ `AGENTCORE_SUCCESS`
4. `SAVE_ATTEMPT`（2回目）

![実AgentCoreを使ったOrdinary Lambdaのログ](/images/agentcore-lambda-durable-retry/12-real-ordinary-logs.png)

Durable側のExecution Historyでは、`invoke_agent` が一度成功したあと、`save_to_s3` が失敗して再試行されています。最終ステータスは `ExecutionSucceeded` でした。

![実AgentCoreを使ったDurable Execution Timeline](/images/agentcore-lambda-durable-retry/13-real-durable-timeline.png)

実際の計数結果はこちらです。

| 実AgentCore実験 | Ordinary | Durable |
| --- | ---: | ---: |
| Agent呼び出し関数の実行 | **2回** | **1回** |
| S3保存の試行 | 2回 | 2回 |
| 最終実行状態 | 処理完了（2回目の保存で成功） | 処理完了（ExecutionSucceeded） |

![実AgentCoreでのDynamoDB計数](/images/agentcore-lambda-durable-retry/14-real-call-counts.png)

Durableの画面に表示された `invoke_agent` Stepの所要時間は約9秒、保存Stepは再試行1回でした。

### 実際にわかったこと

今回の条件では、**Agentの処理が成功したあとでS3保存だけが失敗しても、Durableでは完了済みのAgent Stepを再実行せずに済みました**。AgentCore呼び出しが重い場合ほど、この違いは運用上重要になりそうです。

ただ、ここで忘れたくないのは、Durableが守る単位が**Step**であることです。

## Checkpointがあれば重複実行はなくなる？

答えは、そこまで単純ではありません。

今回のAgent呼び出しは、成功した**外側の `invoke_agent` Step**として記録されました。だから後続のS3 Stepが失敗しても結果を再利用できました。

では、次のような流れで失敗した場合はどうでしょうか。

```text
Durableの invoke_agent Step（まだ完了していない）
  └─ AgentCore Runtime
      ├─ Tool A：設定取得（成功）
      ├─ Tool B：何らかの更新（成功）
      └─ Tool C：エラー
```

Tool C のエラーがAgent内部で処理されず、外側の `invoke_agent` Stepまで例外として伝播した場合、Stepは成功としてCheckpointされません。このStepが再試行されると、Tool Bが再び実行される可能性があります。**Checkpointがあることと、Agent内部のすべてのToolがExactly-onceになることは別です**。リトライの境界はDurable Stepの設計に依存します。

このTool内部失敗のシナリオは**今回まだ実測していません**。今後は実際のEC2を更新するのではなく、DynamoDBに模擬更新を記録し、同じ操作IDによる重複実行と条件付き書き込みによる防止を検証したいと考えています。

また、Agent呼び出しが成功してもその結果のCheckpointが確定する前に問題が起きた場合や、同じ業務リクエストを別のDurable Executionとして起動した場合まで、今回の結果だけで重複防止を保証することはできません。

## 通常LambdaやStep Functionsでもできるのでは？

できます。通常LambdaでもDynamoDBなどに完了状態や分析結果を記録すれば、最初からやり直さずに済む設計は可能です。Step Functionsでも状態単位のリトライや復旧を構成できます。

今回の比較は「Durableでしかできないこと」の証明ではありません。**Lambdaのコード中でAgent呼び出しと保存処理をStepに分け、CheckpointとRetryを扱える**点を実際のログで確認したものです。

実装の見通しがよくなる一方で、Stepの粒度、リトライ条件、外部システムへの副作用は依然として設計が必要です。なお、Durable自体にも実行・Checkpoint等の料金があるため、単純に「必ず安くなる」とは言えません。

## まとめ

今回試して一番はっきりしたのは、**「どこまでを一つの再試行単位にするか」でAgentの再呼び出しが変わる**という点でした。

今回の検証では、初回のS3保存前に例外を発生させたところ、Ordinaryの全体リトライではAgentCore呼び出しが2回、Durable Functionsでは1回という結果になりました。Durable側は成功済みのAgent Stepを再利用し、保存Stepだけを再試行できました。

一方で、Agent内部のToolや外部への更新まで自動的に一度きりになるわけではありません。更新を伴うToolには、引き続き冪等性の設計が必要です。

Agentの処理が長くなったり、Toolが増えたりするほど、**Checkpointの境界をどこに置くか**を最初に考えておく価値がありそうです。

今回の検証が、AI Agentを組み込んだ処理のリトライ設計や、Lambda Durable Functionsの活用を考える際の参考になれば幸いです。

---

### 参考資料

- https://docs.aws.amazon.com/ja_jp/lambda/latest/dg/durable-functions.html
- https://docs.aws.amazon.com/ja_jp/lambda/latest/dg/durable-execution-sdk-retries.html
- https://docs.aws.amazon.com/ja_jp/lambda/latest/dg/concepts-application-design.html
- https://docs.aws.amazon.com/ja_jp/service-authorization/latest/reference/list_amazonbedrockagentcore.html

