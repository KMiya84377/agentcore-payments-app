# AWS AgentCore Paymentsの監視と運用

## 1. このファイルの位置づけ

このファイルは、AWS AgentCore Paymentsを動かした後に、何を監視し、どう運用するかを整理したものです。

実装手順は次のファイルに分けています。

- `04-aws-agentcore-payments-implementation-flow.md`

このファイルでは、CloudWatch、X-Ray、支出監視、異常検知、監査の観点を扱います。

公式ドキュメント:

- https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/payments.html
- https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/payments-how-it-works.html
- https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/payments-create-manager.html

## 2. なぜ監視を分けて考えるのか

AgentCore Paymentsは、通常のAPI呼び出しとは違ってお金が動きます。

そのため、単に「エラーが出ていないか」だけでは不十分です。

見るべきなのは、次の3つです。

```text
技術的に成功しているか:
  支払い処理が成功しているか

費用が想定内か:
  ユーザー、エージェント、セッションごとの支出が妥当か

不正や誤作動がないか:
  想定外の支払い先、回数、金額がないか
```

## 3. 監視に使うAWSサービス

AgentCore Paymentsでは、主にCloudWatchとX-Rayを使います。

```text
CloudWatch:
  ログ、メトリクス、アラームを見る

X-Ray:
  支払い処理のトレースを見る
  どの処理で失敗したかを追う
```

公式ドキュメントでは、AgentCore Paymentsがvended logsとvended spansを提供すると説明されています。

```text
vended logs:
  CloudWatch Logsに出るアプリケーションログ

vended spans:
  X-Rayで見られるトレース情報
```

## 4. まず見るべき指標

最初に見るべき観点は次です。

公式ドキュメントで提供される主なCloudWatchメトリクスは次です。

```text
OperationSuccess:
  API呼び出し成功数

OperationFailure:
  API呼び出し失敗数

OperationLatency:
  API呼び出しのエンドツーエンドレイテンシ

SpendAmount:
  処理された支払い額
  ProcessPaymentのみ

Throttles:
  スロットリング数

UserErrors:
  クライアント側バリデーションエラー数

ActiveSessions:
  アクティブなPaymentSession数

PaymentRequestCount:
  支払い要求数

PaymentSuccessCount:
  支払い成功数

PaymentFailureCount:
  支払い失敗数

PaymentLatency:
  支払い処理レイテンシ
```

メトリクスの主なディメンションは次です。

```text
Operation
PaymentManagerId
PaymentConnectorId
AgentName
Currency
```

運用上は、これらを使って次を見ます。

- 支払い成功率
- 支払い失敗率
- 支払い失敗理由
- `PaymentSession` ごとの支出
- ユーザーごとの支出
- エージェントごとの支出
- Merchantごとの支出
- `ProcessPayment` のレイテンシ

## 5. 支払い失敗時に見るポイント

支払い失敗は、単純なAPIエラーとは限りません。

原因は複数あります。

```text
PaymentSession:
  期限切れ
  予算上限超過

PaymentInstrument:
  残高不足
  ユーザーが権限を許可していない
  instrumentがACTIVEではない

PaymentConnector:
  Coinbase CDPまたはStripe/Privyの認証情報エラー
  外部プロバイダー側の障害

x402:
  payment payloadの形式不正
  assetやnetworkの不一致
  merchant側の検証失敗

IAM / Identity:
  ProcessPayment権限不足
  Secrets Managerの読み取り拒否
  ResourceRetrievalRoleの設定不備
```

## 6. 支出監視

決済で一番重要なのは、想定外の支出を早く検知することです。

最低限、次の単位で支出を集計します。

```text
ユーザー単位:
  どのユーザーがいくら使ったか

エージェント単位:
  どのエージェントがいくら使ったか

PaymentSession単位:
  1つの依頼・作業でいくら使ったか

Merchant単位:
  どの支払い先にいくら払ったか

時間単位:
  1分、1時間、1日でどれくらい増えているか
```

## 7. アラートを出す条件

本番運用では、少なくとも次の条件でアラートを検討します。

- 1ユーザーの支出が一定額を超えた
- 1エージェントの支出が一定額を超えた
- 1セッションで予算上限に頻繁に達する
- 支払い失敗率が急に上がった
- 同じMerchantへの支払いが急増した
- 未知のMerchantへの支払いが発生した
- `ProcessPayment` のレイテンシが悪化した
- Coinbase CDPまたはStripe/Privyの認証エラーが増えた
- Secrets Managerへのアクセス拒否が発生した

## 8. 監査ログとして残したい情報

あとから説明できるように、支払いごとに次の情報を追える必要があります。

- user_id
- agent_id
- payment_session_id
- payment_instrument_id
- payment_manager_arn
- payment_connector_id
- merchant
- amount
- currencyまたはasset
- network
- payment status
- failure reason
- timestamp
- x402 payloadの識別情報
- 再リクエストの結果

重要なのは、「なぜその支払いが発生したのか」をタスクやエージェントの行動と結びつけられることです。

X-Rayのspanでは、`Bedrock.AgentCore.Payments.<Operation>` という名前でデータプレーンAPIごとのspanが出ます。`ProcessPayment` では、支払い額、通貨、残り予算、merchant、credential token取得レイテンシ、agent名などの属性が含まれます。

## 9. セキュリティ運用

支払い監視では、認証情報の扱いも見ます。

特に重要なのは次です。

- Coinbase CDPのAPI Key SecretやWallet Secretを定期的にローテーションする
- PrivyのApp SecretやAuthorization Private Keyを定期的にローテーションする
- PrivyのAuthorization Private Keyは `wallet-auth:` 接頭辞を外して保存する
- Secrets ManagerのsecretをAgentCoreのサービスロール以外から読めないようにする
- `CreatePaymentSession` と `ProcessPayment` の権限を同じ主体に寄せすぎない
- 不要になったPaymentInstrumentやPaymentConnectorを削除する

## 10. Browser Tool利用時の監視

Browser Toolを使う場合は、通常のAPI呼び出しより監視点が増えます。

見るべき観点は次です。

- どのURLにアクセスしたか
- どのレスポンスで402を検出したか
- x402条件を正しく抽出できたか
- 支払い後の再アクセスが成功したか
- ペイウォール後のページ取得に成功したか
- 同じページに対して支払いが重複していないか

Browser Toolでは、ページ内のリダイレクトや追加リソース読み込みでも複数のHTTPレスポンスが発生します。どの402に対して支払ったのかを追えるようにしておく必要があります。

## 11. 運用チェックリスト

本番前には、最低限このチェックリストを確認します。

```text
[ ] CloudWatch LogsでAgentCore Paymentsのログが見える
[ ] X-Rayで支払い処理のトレースが見える
[ ] 支払い成功率を確認できる
[ ] 支払い失敗理由を分類できる
[ ] ユーザーごとの支出を確認できる
[ ] エージェントごとの支出を確認できる
[ ] PaymentSessionごとの支出を確認できる
[ ] Merchantごとの支出を確認できる
[ ] 予算上限超過の拒否を検知できる
[ ] 残高不足を検知できる
[ ] Coinbase CDP / Stripe Privyの認証エラーを検知できる
[ ] 未知のMerchantへの支払いを検知できる
[ ] 支出急増時のアラートがある
[ ] 秘密情報のアクセス範囲を確認した
[ ] 秘密情報のローテーション手順がある
```

## 12. まとめ

AgentCore Paymentsの監視では、APIの成功失敗だけではなく、支出、権限、支払い先、認証情報まで見る必要があります。

特に重要なのは次です。

```text
支出:
  想定外に増えていないか

権限:
  誰が支払い枠を作り、誰が支払いを実行できるか

支払い先:
  どのMerchantに払っているか

認証情報:
  Coinbase CDP / Stripe Privyの秘密情報が守られているか
```
