---
title: AWS WAFのSQLi_BODYだけを制御する｜Managed RuleのCount + Labelを使った誤検知対策
emoji: 🛡️
type: tech
topics:
  - aws
  - waf
  - security
  - terraform
published: false
date: "2026-08-31"
---

# はじめに

AWS WAF の Managed Rule を利用していると、ログイン画面などで正当なリクエストが SQL インジェクションとして誤検知されることがあります。

このような場合、

- SQLi Rule 全体を除外する
- 対象 URI 全体を除外する

という対応も考えられますが、どちらも本来必要な保護まで失われてしまいます。

そこで今回は、**SQLi_BODY のみを対象に制御する方法**として、Managed Rule の **Count + Label** を利用した構成を紹介します。

## なぜ SQLi_BODY が問題になるのか

今回対象となったリクエストは、`application/x-www-form-urlencoded` 形式で送信される POST リクエストです。

この形式では、HTTP Body 全体が

```text
username=user&password=******
```
のような 1 つの文字列として扱われます。

そのため、パスワードに SQL インジェクションのシグネチャと類似した文字列が含まれている場合、
`SQLi_BODY` が Body 全体を対象として検知することがあります。

一方で、JSON (`application/json`) の場合は、
AWS WAF では JSON Body を対象とした検査や JSON Pointer を利用した除外設定など、別の制御方法を選択できるケースがあります。

そのため、本記事で紹介する方法は、特に **`application/x-www-form-urlencoded` のようなフォームデータ** に対する誤検知対策として有効な構成です。

# 今回の構成

今回の Web ACL は次のような構成です。

![Rules](/images/aws-waf-sqli-body-count-label/rules-overview.png)

利用する Rule は非常にシンプルです。

- AWSManagedRulesSQLiRuleSet
- Custom Rule

Managed Rule 自体はそのまま利用し、Custom Rule で例外制御を行います。


# SQLi_BODYだけをCountへ変更する

まず、Managed Rule の `SQLi_BODY` を **Block** から **Count** に変更します。

![SQLi_BODY Count](/images/aws-waf-sqli-body-count-label/sqli-body-count.png)

重要なのは、**Managed Rule を無効化しているわけではない**という点です。

Count に変更することで、

- SQLi_BODY は引き続き検知される
- Managed Label が付与される
- 後続の Custom Rule で判定できる

という状態になります。

つまり、「検知」と「制御」を分離できるようになります。


# Labelを利用して例外制御する

今回のポイントは、`SQLi_BODY` が付与する Managed Label を利用することです。

考え方は次のようになります。

```text
HTTP Request

        │
        ▼

AWSManagedRulesSQLiRuleSet

        │
        ▼

SQLi_BODY

Block → Count

        │
        ▼

Managed Label

        │
        ▼

Custom Rule

Label Match
AND
NOT(
URI = /login
AND
Method = POST
)

        │
        ├──────────────┐
        │              │
        ▼              ▼

POST /login      Other URI

        │              │
        ▼              ▼

Default Allow    Block
```

つまり、

ログイン URI (`POST /login`) のみ Block の対象外とし、それ以外の URI は引き続き Block します。

今回利用した Statement は次のようになります。

```json
{
    "Name": "Block-SQLi-Body-Except-Login",
    "Priority": 20,
    "Statement": {
        "AndStatement": {
            "Statements": [
                {
                    "LabelMatchStatement": {
                        "Scope": "LABEL",
                        "Key": "awswaf:managed:aws:sql-database:SQLi_Body"
                    }
                },
                {
                    "NotStatement": {
                        "Statement": {
                            "AndStatement": {
                                "Statements": [
                                    {
                                        "ByteMatchStatement": {
                                            "SearchString": "/login",
                                            "FieldToMatch": {
                                                "UriPath": {}
                                            },
                                            "TextTransformations": [
                                                {
                                                    "Priority": 0,
                                                    "Type": "NONE"
                                                }
                                            ],
                                            "PositionalConstraint": "EXACTLY"
                                        }
                                    },
                                    {
                                        "ByteMatchStatement": {
                                            "SearchString": "POST",
                                            "FieldToMatch": {
                                                "Method": {}
                                            },
                                            "TextTransformations": [
                                                {
                                                    "Priority": 0,
                                                    "Type": "NONE"
                                                }
                                            ],
                                            "PositionalConstraint": "EXACTLY"
                                        }
                                    }
                                ]
                            }
                        }
                    }
                }
            ]
        }
    },
    "VisibilityConfig": {
        "SampledRequestsEnabled": true,
        "CloudWatchMetricsEnabled": true,
        "MetricName": "BlockSQLiBodyExceptLogin"
    },
    "Action": {
        "Block": {}
    }
}
```

Visual Builder では複雑なネスト条件を表現しづらい場合があるため、本記事では Statement の考え方を JSON で示しています。


# 動作確認

今回の検証では Terraform を利用して ALB と AWS WAF の簡単な検証環境を構築しました。検証では、`application/x-www-form-urlencoded` の POST リクエストを利用しています。

## 動作確認

今回の検証では Terraform を利用して ALB と AWS WAF の簡単な検証環境を構築しました。

検証では、`application/x-www-form-urlencoded` の POST リクエストを利用して動作を確認しました。

検証対象は次の 3 パターンです。

### Test1：通常のログインリクエスト

```bash
curl -i \
  -X POST \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "username=test-user" \
  --data-urlencode "password=normal-password-123" \
  "http://<ALB-DNS>/login"
```

期待結果

```text
HTTP 200
```

---

### Test2：SQLi を含むログインリクエスト

```bash
curl -i \
  -X POST \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "username=test-user" \
  --data-urlencode "password=' OR 1=1 --" \
  "http://<ALB-DNS>/login"
```

期待結果

```text
SQLi_BODY
↓

Count

↓

Managed Label

↓

Custom Rule（対象外）

↓

HTTP 200
```

---

### Test3：SQLi を含むその他の URI

```bash
curl -i \
  -X POST \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "username=test-user" \
  --data-urlencode "password=' OR 1=1 --" \
  "http://<ALB-DNS>/normal"
```

期待結果

```text
SQLi_BODY
↓

Count

↓

Managed Label

↓

Custom Rule

↓

Block

↓

HTTP 403
```

実際の実行結果は次のとおりです。

![CloudShell Test](/images/aws-waf-sqli-body-count-label/test-result.png)

期待どおり、

| Request | Result |
|---------|--------|
| 通常の Login | 200 |
| SQLi を含む Login | 200 |
| SQLi を含む Other URI | 403 |

となることを確認できました。


# Sampled Requestで確認する

Sampled Request を確認すると、`SQLi_BODY` が Count として検知されていることが確認できます。

![Sampled Login](/images/aws-waf-sqli-body-count-label/sampled-request.png)

どちらも SQLi_BODY は検知されていますが、その後の Custom Rule によって、

- Login URI は Allow
- Other URI は Block

という制御になっています。

詳細は下図の通りです。

ログイン URI

![Sampled Login](/images/aws-waf-sqli-body-count-label/sampled-login.png)

その他の URI

![Sampled Normal](/images/aws-waf-sqli-body-count-label/sampled-normal.png)


# まとめ

今回は、AWS WAF の `SQLi_BODY` のみを対象に制御する方法を紹介しました。

ポイントは次の 3 点です。

- SQLi Rule 全体を無効化しない
- SQLi_BODY のみ Count に変更する
- Label を利用して Custom Rule で例外制御する

この構成であれば、Managed Rule の検知能力を維持しながら、必要最小限の例外制御を実現できます。

SQLi_BODY 以外にも、Managed Rule が付与する Label を活用することで、より柔軟な例外制御へ応用できると考えています。


# 参考資料

https://docs.aws.amazon.com/waf/latest/developerguide/waf-rule-label-overview.html

https://docs.aws.amazon.com/waf/latest/developerguide/web-acl.html
