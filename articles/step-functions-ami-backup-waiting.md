---
title: "Step FunctionsでEC2バックアップ｜AMIがavailableになるまで本当に待つ必要がある？"
emoji: "⏳"
type: "tech"
topics:
  - aws
  - stepfunctions
  - ec2
  - eventbridge
  - automation
published: false
date: "2026-09-06"
---

## はじめに
こんにちは、宋です。

今回、EC2 の定期バックアップとして、AWS Step Functions を利用して AMI を自動作成する仕組みを構築しました。

今回の構成では、EC2 を停止してから AMI 作成を開始し、その後 EC2 を再起動します。

最初は安全側に考えて、**AMI が `available` になったことを確認してから EC2 を起動する**構成にしていました。

```text
EC2停止
  ↓
CreateImage
  ↓
AMIがavailableになるまで待機
  ↓
EC2起動
```

しかし実際に検証してみると、AMI がまだ正常に作成中であるにもかかわらず、Step Functions 側が先に失敗するケースがありました。

そこで今回は、AMI 作成時の待機方法を見直しました。

## AMIがavailableになるまで待つ構成

`CreateImage` API を実行すると AMI ID が返されますが、その時点で AMI 作成が完了しているわけではありません。

AMI は作成中の `pending` を経て、作成が完了すると `available` になります。

```text
CreateImage
    ↓
pending
    ↓
available
```

そのため、最初の State Machine では `DescribeImages` で AMI の状態を確認し、`available` になるまで待機する構成にしていました。

```text
CreateImage
    ↓
Wait
    ↓
DescribeImages
    ↓
available？
 ├─ No → Wait
 └─ Yes
       ↓
   StartInstance
```

ただし、AMI が `available` になるまでの時間は一定ではありません。

待機処理に上限を設定している場合、AMI がまだ `pending` のままだと Step Functions 側が先に待機上限へ到達します。

また、その間 EC2 を停止したままにすると、AMI 作成に時間がかかるほど EC2 の停止時間も長くなります。

## Step Functionsは失敗したが、AMIは作成中だった

実際に検証したところ、AMI の作成完了を待っていた Step Functions は最終的に `Failed` となりました。

実行結果では、失敗経路である `BackupStartFailed` まで遷移していることが確認できます。

![AMI作成待機で失敗したStep Functions](/images/step-functions-ami-backup-waiting/step-functions-backup-failed.png)

ここで気になったのが、**「Step Functions が失敗した時点で、AMI も本当に失敗しているのか？」** という点です。

失敗時の実行データを確認すると、AMI の状態は `failed` ではなく、まだ `pending` でした。

![Step Functions失敗時もAMIはpending](/images/step-functions-ami-backup-waiting/step-functions-failed-while-ami-pending.png)

つまり、この時点では、

```text
Step Functions = Failed
AMI            = pending
```

という状態でした。

AMI 作成そのものが失敗したわけではなく、AMI の作成処理はまだ継続しています。

その後 AMI を確認すると、最終的には `available` になっていました。

![Step Functions失敗後にavailableとなったAMI](/images/step-functions-ami-backup-waiting/ami-available-after-workflow-failure.png)

今回の結果から、**Step Functions の失敗と AMI 作成の失敗は、分けて考える必要がある**ことが分かりました。

`CreateImage` の成功は AMI 作成処理を開始できたことを意味し、`pending` は作成中、`available` になって初めて AMI 作成完了となります。

## pendingを確認したらEC2を起動する

そこで、AMI が `available` になるまで Step Functions 内で待ち続ける構成を見直しました。

変更後の State Machine は次のようになります。

![見直し後のStep Functions全体構成](/images/step-functions-ami-backup-waiting/step-functions-workflow.png)

EC2 が `stopped` になったことを確認してから `CreateImage` を実行し、その後 `DescribeImages` で AMI の状態を確認します。

ここでは `available` になるまで待つのではなく、

- `pending`
- `available`

のどちらかであれば `StartInstance` へ進むようにしました。

```json
"CheckImageState": {
  "Type": "Choice",
  "Choices": [
    {
      "Variable": "$.imageStatus.Images[0].State",
      "StringEquals": "pending",
      "Next": "StartInstance"
    },
    {
      "Variable": "$.imageStatus.Images[0].State",
      "StringEquals": "available",
      "Next": "StartInstance"
    }
  ],
  "Default": "StartInstanceAfterImageError"
}
```

実際の実行でも、AMI が `pending` の段階で `StartInstance` へ進み、EC2 の起動後に Step Functions が正常終了することを確認できました。

![pending確認後にEC2を起動して正常終了](/images/step-functions-ami-backup-waiting/step-functions-pending-check.png)

これによって、

```text
EC2停止
  ↓
CreateImage
  ↓
pending確認
  ↓
EC2起動
  ↓
Step Functions終了

AMI作成処理
  ↓
そのまま継続
```

という構成になります。

AMI 作成完了まで Step Functions が待つ必要がなくなり、EC2 の停止時間も必要以上に長くしない構成にできました。

## AMI作成失敗はEventBridgeで監視する

一方で、`pending` の段階で Step Functions を先へ進めると、その後 AMI 作成自体が失敗した場合を検知する必要があります。

そこで今回は、Amazon EventBridge の `EC2 AMI State Change` を利用し、AMI が `failed` になった場合のみ通知するようにしました。

Event Pattern は次のとおりです。

```json
{
  "source": ["aws.ec2"],
  "detail-type": ["EC2 AMI State Change"],
  "detail": {
    "State": ["failed"]
  }
}
```

実際に作成した EventBridge Rule は次のとおりです。

![AMI作成失敗を監視するEventBridge Rule](/images/step-functions-ami-backup-waiting/eventbridge-ami-failed-rule.png)

今回は Lambda を利用せず、EventBridge から SNS へ直接通知するシンプルな構成にしました。

```text
Step Functions
  ↓
AMI作成開始
  ↓
EC2復旧
  ↓
終了

AMI
  ↓
failed
  ↓
EventBridge
  ↓
SNS
```

これによって役割を、

- **Step Functions：AMI 作成開始と EC2 の停止・復旧**
- **EventBridge：AMI 作成失敗の検知**

に分けています。

:::message
今回の EventBridge Rule は検証用として、同一リージョン内のすべての AMI の `failed` イベントを対象としています。

また、`failed` の監視だけでは、「その日のバックアップが作成されなかった」といったケースは検知できません。

実運用でバックアップ取得自体を保証したい場合は、監視対象の AMI を識別する仕組みや、期待する AMI が存在するかを定期的に確認する仕組みを別途検討する必要があります。
:::

## まとめ

最初は、AMI が `available` になるまで Step Functions 内で待つ構成にしていました。

しかし実際に検証すると、

```text
Step Functions = Failed
AMI            = pending
                ↓
              available
```

という状態が発生しました。

つまり、**Workflow が失敗したことと、AMI 作成そのものが失敗したことは同じではありません。**

そこで今回は、AMI が `pending` になったことを確認した段階で EC2 を起動し、AMI 作成完了まで Step Functions 内で待たない構成へ変更しました。

その後 AMI が `failed` になった場合は、EventBridge で検知します。

今回の検証を通して、非同期 API を Workflow に組み込む場合は、**「API が成功したこと」と「処理そのものが完了したこと」を分けて考える**ことが重要だと感じました。

単純に「完了するまで待つ」のではなく、**Workflow がどこまで待つ必要があるのか、どこから先を別の監視に任せるのか**を考えることも、待機設計の一つだと思います。

同じように Step Functions で非同期処理の待機方法を検討している方の参考になれば幸いです。

## 参考資料

https://docs.aws.amazon.com/ja_jp/step-functions/latest/dg/supported-services-awssdk.html

https://docs.aws.amazon.com/ja_jp/AWSEC2/latest/UserGuide/monitor-ami-events.html

https://docs.aws.amazon.com/ja_jp/AWSEC2/latest/UserGuide/monitor-ami-events.html

https://docs.aws.amazon.com/ja_jp/AWSEC2/latest/APIReference/API_Image.html