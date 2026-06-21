# AgentCore Paymentsの設計考慮事項

## 1. このファイルの位置づけ

このファイルは、AgentCore Paymentsをアプリケーションに組み込むときの設計論点を整理したものです。

特に次を扱います。

```text
1. PaymentInstrumentとユーザーの紐づけ
2. PaymentSessionをどこで作るか
3. CognitoログインとAgentCore Runtimeの関係
```

## 2. PaymentInstrumentとユーザーの紐づけ

PaymentInstrumentは、作成時に渡す `user_id` によってユーザーに紐づきます。

AgentCore SDKで作る場合のイメージは次です。

```python
manager.create_payment_instrument(
    user_id="user-123",
    payment_connector_id="connector-abc",
    payment_instrument_type="EMBEDDED_CRYPTO_WALLET",
    payment_instrument_details={
        "embeddedCryptoWallet": {
            "network": "ETHEREUM"
        }
    },
)
```

構造としては次のように考えます。

```text
アプリのユーザー
  ↓
Payment user_id
  ↓
PaymentInstrument
  ↓
外部ウォレット / embedded wallet
```

ただし、`user_id` を渡してPaymentInstrumentを作っただけでは、まだ支払い可能とは限りません。

支払い可能にするには、一般に次が必要です。

```text
1. アプリ側でユーザーを識別する
2. そのユーザーIDをPaymentInstrument作成時のuser_idに使う
3. PaymentInstrumentを作る
4. Coinbase CDPならWalletHubへ誘導する
5. ユーザーが入金する
6. ユーザーがエージェントへの利用権限を付与する
7. PaymentInstrumentが支払い可能になる
```

認証方式によって、ユーザーIDの扱いは変わります。

| 認証方式 | ユーザー紐づけ |
| --- | --- |
| AWS_IAM | アプリ側が `user_id` を明示的に渡す |
| CUSTOM_JWT / OAuth | JWTの `sub` などをPayment user_idとして使う設計にできる |

このプロジェクトでは、Cognito access token の `sub` を AgentCore Payments の `user_id`
として使います。メールアドレスはAgentCore Runtimeへ渡しません。

参考:

- [Process payments with AgentCore Payments](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/payments-processing.html)
- [Amazon Cognito with AgentCore](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/identity-idp-cognito.html)

## 3. PaymentSessionはどこで作るか

PaymentSessionは、期限と予算上限を持つ支払い枠です。

```text
このユーザーのこのタスクでは
60分間だけ
最大10 USDまで
支払いを許可する
```

これは初期セットアップ用の固定リソースではありません。タスク開始時やエージェント実行開始時に都度作るのが自然です。

作る場所は大きく2パターンあります。

## 4. パターンA: Strands Agent内でPaymentSessionを作る

流れは次です。

```text
ユーザーがAgentに依頼する
  ↓
Agent RuntimeがPaymentSessionを作る
  ↓
AgentCorePaymentsPluginにSession IDを渡す
  ↓
有料APIが402を返す
  ↓
PluginがProcessPaymentを実行する
```

メリット:

- Agent実行ごとに支払い枠を作りやすい
- タスク単位の予算・期限管理をAgent側で完結しやすい

注意点:

- Runtime Roleに `CreatePaymentSession` 権限が必要になる
- Agentが自分で支払い枠を作れるため、上限金額や期限をコード側で強く制限する必要がある
- ユーザー承認をどこで取ったのかが曖昧になりやすい

この方式はPoCでは便利ですが、本番では支出制御を慎重に設計する必要があります。

## 5. パターンB: Agent外でPaymentSessionを作る

流れは次です。

```text
フロントエンドでユーザーがログインする
  ↓
ユーザーが支払い上限やタスク実行を承認する
  ↓
BackendがPaymentSessionを作る
  ↓
Session IDをAgent Runtimeへ渡す
  ↓
AgentはそのSession内でだけ支払う
```

メリット:

- ユーザー承認と予算設定をAgent外で制御できる
- Runtime Roleから `CreatePaymentSession` を外せる
- Agentは既存Session IDを使って支払い処理に専念できる

注意点:

- フロントエンドまたはBackend側の実装が必要
- Agent呼び出し時にPaymentSession IDを渡す設計が必要

この方式は本番寄りの設計として安全です。

```text
CI/CD or 管理スクリプト:
  PaymentCredentialProvider
  PaymentManager
  PaymentConnector

ユーザー連携フロー:
  PaymentInstrument

Backend:
  PaymentSession作成

Strands Agent:
  既存Session IDを使ってProcessPayment
```

参考:

- [Process payments with AgentCore Payments](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/payments-processing.html)

## 6. CognitoログインとAgentCore Runtime

ユーザー向けアプリにする場合、ログイン画面はCognito User Poolで作るのが自然です。

AgentCore Runtimeは、Inbound AuthとしてOAuth 2.0 / JWT bearer tokenを受け付ける構成にできます。

大まかな流れは次です。

```text
ユーザー
  ↓
フロントエンドでCognitoログイン
  ↓
access token / ID tokenを取得
  ↓
フロントエンドまたはBackendがAgentCore Runtimeを呼ぶ
  ↓
AgentCore Runtimeがtokenを検証する
  ↓
Agentがユーザーの文脈で処理する
```

AgentCore Runtimeの呼び出しでは、Bearer tokenを渡せます。OAuth連携を使う場合は、AWS SDKではなくHTTPSリクエストで `InvokeAgentRuntime` を呼ぶ必要があると公式ドキュメントに記載されています。

参考:

- [Invoke an AgentCore Runtime agent](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-invoke-agent.html)
- [Authenticate and authorize with Inbound Auth and Outbound Auth](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-oauth.html)
- [Amazon Cognito with AgentCore](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/identity-idp-cognito.html)

## 7. 推奨方針

本番寄りには、次の構成がよいです。

```text
Frontend:
  React / Next.js
  Cognito login

Backend:
  ユーザーID確認
  PaymentInstrument管理
  PaymentSession作成
  AgentCore Runtime呼び出し

AgentCore Runtime:
  Strands Agent
  AgentCorePaymentsPlugin
  既存PaymentSession IDを使って支払い
```

理由は次です。

```text
PaymentCredentialProvider / PaymentManager / PaymentConnector:
  初期セットアップで作る

PaymentInstrument:
  ユーザー連携フローで作る

PaymentSession:
  Backendでユーザー承認後に都度作る

Strands Agent:
  支払い枠を作るのではなく、渡された枠の中で支払う
```

この構成では、PaymentSessionをBackendで作り、Strands Agentには既存のPaymentSession IDを渡します。Agentは支払い枠を作るのではなく、渡された枠の中で支払う役割に寄せます。

## 8. このプロジェクトでの現在の組み込み方針

初期セットアップは完了済みとし、決済プロバイダーはStripe/Privy、Paymentsのリージョンは
`us-east-1` を使います。

現在のPython Agent Runtimeでは、次の環境変数がそろっていればPayments機能を使えます。

```text
PAYMENTS_REGION=us-east-1
PAYMENT_MANAGER_ARN=...
PAYMENT_CONNECTOR_ID=...
```

`PAYMENT_INSTRUMENT_ID`、`PAYMENT_SESSION_ID`、`PAYMENT_USER_ID` は固定環境変数としては使いません。

実行時の流れは次です。

```text
1. フロントエンドがAmplify sessionからCognito subを取得する
2. Next.js APIがAuthorization bearer tokenとAgentCore custom headerをRuntimeへ転送する
3. Agent Runtimeがcustom headerからsubを読む
4. subをAgentCore Paymentsのuser_idとして使う
5. list_payment_instruments(user_id=sub)でACTIVEなInstrumentを探す
6. ACTIVEなInstrumentがあればPaymentSessionを作る
7. Instrument IDとSession IDを使ってAgentCorePaymentsPluginをリクエストごとに構成する
8. ACTIVEなInstrumentがなければ、Payments PluginなしでAgentを起動する
```

AgentCore Runtimeへ渡すcustom headerは、CDK側の `requestHeaderConfiguration`
でallowlistする必要があります。このプロジェクトでは次の1つだけを許可しています。

```text
X-Amzn-Bedrock-AgentCore-Runtime-Custom-User-Sub
```

Agentには `strands_tools.http_request` を追加し、Payments Pluginの自動支払い対象は
`http_request` toolだけに制限しています。

```text
payment_tool_allowlist:
  http_request
```

このため、Agentが有料APIへHTTPアクセスし、相手がx402形式の `402 Payment Required`
を返した場合に、PluginがPaymentSessionとPaymentInstrumentを使って支払いヘッダーを生成し、
再リクエストします。

注意点として、現在の実装はPoC向けにAgent Runtime内でPaymentSessionを作ります。
本番寄りにする場合は、次の形に寄せます。

```text
Frontend / Next.js API:
  Cognitoユーザーを確認する
  ユーザー承認後にPaymentSessionを作る
  Agent呼び出しごとにPaymentSession IDを渡す

Agent Runtime:
  渡されたPaymentSession IDを使って支払い処理する
  PaymentSession自体は作らない
```

つまり、今回の実装は「DBなしでCognito subからInstrumentを検索し、Agent Runtime内で
PaymentSessionを作るPoC構成」です。ユーザー承認や予算設定をより厳密に扱う段階では、
PaymentSession作成をNext.js API側に移す想定です。

## 9. PaymentInstrument作成ツールの流れ

現在のAgentには、PaymentInstrumentを扱うツールも追加しています。

```text
list_payment_instruments
  Cognito subに紐づくPaymentInstrument一覧を確認する

get_payment_instrument
  指定したPaymentInstrumentの詳細を確認する

create_payment_instrument
  ユーザーの明示的な許可後にPaymentInstrumentを作成する

get_payment_instrument_balance
  指定したPaymentInstrumentの残高を確認する

create_payment_session
  現在のCognitoユーザーに対して期限と上限つきのPaymentSessionを作成する
```

ユーザー識別には、フロントエンドがAmplify sessionから取得してcustom headerで渡した
Cognito `sub` を使います。

```text
Cognito sub
  -> AgentCore Payments user_id
```

メールアドレスはAgentCore Runtimeへ自動転送しません。PaymentInstrument作成時に
`linkedAccounts.email` が必要な場合だけ、ユーザーの明示的な入力として扱います。

Agentの支払い設定フローは次です。

```text
1. ユーザーが支払い設定を依頼する
2. Agentがlist_payment_instrumentsで既存Instrumentを確認する
3. 既存Instrumentがあれば、それを使う候補として提示する
4. 既存Instrumentがなければ、Agentがユーザーに作成許可を求める
5. ユーザーが明示的に許可した場合だけcreate_payment_instrumentを呼ぶ
6. redirectUrlが返った場合、ユーザーに入金と署名権限付与を案内する
```

これにより、Agentが勝手にPaymentInstrumentを作ることを避けます。

PoCではDBを使わず、毎回AgentCore Paymentsの `list_payment_instruments(user_id=sub)` を
source of truth として扱います。本番では支払い設定画面またはNext.js API側で同じ流れを実装し、
必要に応じて作成済みInstrument IDをアプリDBに保存する方が管理しやすくなります。
