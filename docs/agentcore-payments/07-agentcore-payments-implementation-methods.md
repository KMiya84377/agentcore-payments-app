# AgentCore Paymentsのリソースと実現方法

## 1. このファイルの位置づけ

このファイルは、Amazon Bedrock AgentCore Paymentsを実装するときに、どのリソースや操作をどの手段で実現するかを整理したものです。

特に次を分けて考えます。

```text
リソース作成:
  PaymentCredentialProvider、PaymentManager、PaymentConnectorなどを作る話

操作 / 実行時処理:
  ProcessPayment、x402ヘッダー生成、Strands Agent連携など、実行時に動く話

周辺インフラ:
  IAM Role、Runtime権限、環境変数など、Paymentsを動かすための土台
```

## 2. 前提

実現方法として主に次があります。

| 実現方法 | 位置づけ |
| --- | --- |
| CFn | CloudFormation resource typeとしてAWSリソースを宣言する |
| CDK | CloudFormationに対応しているリソースをL1 Constructなどで定義する |
| AWS CLI | AgentCore Control Plane / Data Plane APIをコマンドで呼ぶ |
| AWS SDK | Boto3などからAgentCore APIを直接呼ぶ |
| AgentCore SDK | Payments向けの便利クラスを使う |
| Strands Plugin | Strands AgentのTool呼び出しで402を検出し、支払いと再試行を自動化する |

重要なのは、CFn/CDKは万能ではないことです。

2026年6月4日時点で確認した範囲では、CloudFormationに `AWS::BedrockAgentCore::PaymentCredentialProvider` があり、`aws-cdk-lib@2.257.0` にもL1 Constructの `CfnPaymentCredentialProvider` があります。一方で、`AWS::BedrockAgentCore::PaymentManager`、`AWS::BedrockAgentCore::PaymentConnector`、`CfnPaymentManager`、`CfnPaymentConnector` は確認できませんでした。

つまり、CFn/CDKで扱えるPaymentsリソースは一部に限られます。

また、Paymentsリソースはすべて同じライフサイクルではありません。

| 種類 | 主なリソース | 作るタイミング |
| --- | --- | --- |
| 初期設定リソース | PaymentCredentialProvider / PaymentManager / PaymentConnector | 決済基盤のセットアップ時 |
| ユーザー単位のリソース | PaymentInstrument | ユーザーのウォレット作成・連携時 |
| 都度作るリソース | PaymentSession | タスク開始時、エージェント実行時、支払い枠が必要になったタイミング |

特にPaymentSessionは、CDKで固定的に作るものではなく、期限と予算上限を持つ「このタスク用の支払い枠」として都度作るのが自然です。

一方で、`ProcessPayment` はリソースではありません。PaymentSessionとPaymentInstrumentを使って、実際に支払いが必要になった瞬間に呼び出す実行時API操作です。

参考:

- [CDK aws_bedrockagentcore module](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_bedrockagentcore-readme.html)
- [CloudFormation Bedrock AgentCore resources](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/AWS_BedrockAgentCore.html)

## 3. リソース作成

| Paymentsリソース | CFn | CDK | AWS CLI | AWS SDK | AgentCore SDK |
| --- | --- | --- | --- | --- | --- |
| PaymentCredentialProvider | 可 | 可 | 可 | 可 | 可 |
| PaymentManager | 不可 | 不可 | 可 | 可 | 可 |
| PaymentConnector | 不可 | 不可 | 可 | 可 | 可 |
| PaymentInstrument | 不可 | 不可 | 可 | 可 | 可 |
| PaymentSession | 不可 | 不可 | 可 | 可 | 可 |

## 4. リソース作成の詳細

### 4.1 PaymentCredentialProvider

PaymentCredentialProviderは、Coinbase CDPやStripe Privyの認証情報をAgentCore Identity側に保存するリソースです。

CloudFormationでは次のresource typeとして対応しています。

```text
AWS::BedrockAgentCore::PaymentCredentialProvider
```

CDKでは、そのL1 Constructとして対応しています。

```text
aws-cdk-lib/aws-bedrockagentcore.CfnPaymentCredentialProvider
```

ただし、CFn/CDKで作る場合は注意が必要です。PaymentCredentialProviderには次のような秘密情報が入ります。

```text
Coinbase CDP:
  API Key ID
  API Key Secret
  Wallet Secret

Stripe Privy:
  App ID
  App Secret
  Authorization ID
  Authorization Private Key
```

これらをCloudFormation template、CDK context、CDKソースコードに直接入れると、CloudFormation template、CDK Cloud Assembly、ローカルファイル、Git履歴に残る可能性があります。

そのため、「CFn/CDKで作れる」は正しいですが、実装上はAgentCore SDKまたはAWS CLIで作る方が扱いやすいです。

参考:

- [CDK CfnPaymentCredentialProvider](https://docs.aws.amazon.com/cdk/api/v2/python/aws_cdk.aws_bedrockagentcore/CfnPaymentCredentialProvider.html)
- [CloudFormation Bedrock AgentCore resources](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/AWS_BedrockAgentCore.html)
- [Create a Payment Manager and Connector](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/payments-create-manager.html)

### 4.2 PaymentManager

PaymentManagerは、AgentCore Paymentsの親リソースです。

主に次を持ちます。

```text
Payment Manager名
説明
認可方式 AWS_IAM / CUSTOM_JWT
Payments用Service Role
PaymentConnector
```

2026年6月4日時点で確認した範囲では、CloudFormation/CDKのリソースとしては確認できませんでした。

そのため、作成方法は次のいずれかです。

```text
AWS CLI:
  aws bedrock-agentcore-control create-payment-manager

AWS SDK:
  boto3 client("bedrock-agentcore-control").create_payment_manager()

AgentCore SDK:
  PaymentClient.create_payment_manager_with_connector()
```

最初の実装では、AgentCore SDKの `create_payment_manager_with_connector()` を使うのが簡単です。PaymentManager、PaymentCredentialProvider、PaymentConnectorをまとめて作れます。

参考:

- [Create a Payment Manager and Connector](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/payments-create-manager.html)
- [CDK aws_bedrockagentcore module](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_bedrockagentcore-readme.html)
- [CloudFormation Bedrock AgentCore resources](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/AWS_BedrockAgentCore.html)

### 4.3 PaymentConnector

PaymentConnectorは、PaymentManagerと外部決済プロバイダーをつなぐリソースです。

対応する外部プロバイダーは次です。

```text
CoinbaseCDP
StripePrivy
```

PaymentConnectorはPaymentCredentialProviderを参照します。

```text
PaymentManager
  ↓
PaymentConnector
  ↓
PaymentCredentialProvider
  ↓
Coinbase CDP / Stripe Privy
```

2026年6月4日時点で確認した範囲では、CloudFormation/CDKのリソースとしては確認できませんでした。

そのため、作成方法は次のいずれかです。

```text
AWS CLI:
  aws bedrock-agentcore-control create-payment-connector

AWS SDK:
  boto3 client("bedrock-agentcore-control").create_payment_connector()

AgentCore SDK:
  PaymentClient.create_payment_manager_with_connector()
```

参考:

- [Create a Payment Manager and Connector](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/payments-create-manager.html)

### 4.4 PaymentInstrument

PaymentInstrumentは、ユーザーの支払い手段です。

AgentCore Paymentsでは、主に組み込み暗号資産ウォレットとして扱います。

```text
payment_instrument_type = EMBEDDED_CRYPTO_WALLET
```

ネットワーク例は次です。

```text
ETHEREUM
SOLANA
```

PaymentInstrumentはユーザーやウォレットに紐づくため、CDKで静的に作る対象ではありません。ユーザー登録、ウォレット作成、入金、署名権限付与といった流れに近いです。

そのため、作成方法は次のいずれかです。

```text
AWS CLI
AWS SDK
AgentCore SDK PaymentManager.create_payment_instrument()
```

Coinbase CDPの場合、作成後にユーザーをWalletHubへ誘導するURLが返る想定です。Instrumentを作っただけでは支払いはできず、ユーザーによる入金と権限付与が必要です。

参考:

- [Process payments with AgentCore Payments](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/payments-processing.html)
- [Create a Payment Manager and Connector](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/payments-create-manager.html)

### 4.5 PaymentSession

PaymentSessionは、期限と予算上限を持つ支払い枠です。

例:

```text
このユーザーのこのタスクでは
60分間だけ
最大10 USDまで支払いを許可する
```

PaymentSessionも、タスクやユーザー操作に応じて作る実行時寄りのリソースです。CDKで静的に作る対象ではありません。

作成方法は次のいずれかです。

```text
AWS CLI
AWS SDK
AgentCore SDK PaymentManager.create_payment_session()
```

Strands Agentで自動支払いを使う場合も、事前にPaymentSession IDを用意し、AgentCorePaymentsPluginに渡します。

参考:

- [Process payments with AgentCore Payments](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/payments-processing.html)

## 5. 操作 / 実行時処理

| 操作 | CFn | CDK | AWS CLI | AWS SDK | AgentCore SDK | Strands Plugin |
| --- | --- | --- | --- | --- | --- | --- |
| ProcessPayment | 不可 | 不可 | 可 | 可 | 可 | 可 |
| x402 payment header生成 | 不可 | 不可 | 不向き | 不向き | 可 | 可 |
| Strands AgentへのPayments組み込み | 不可 | 不可 | 不可 | 不可 | 一部可 | 可 |

## 6. 操作 / 実行時処理の詳細

### 6.1 ProcessPayment

ProcessPaymentは、実際に支払い処理をAgentCore Paymentsに依頼する操作です。

必要になる主な入力は次です。

```text
Payment Manager ARN
Payment Connector ID
Payment Instrument ID
Payment Session ID
payment_type = CRYPTO_X402
x402 payment payload
user_id
```

実現方法は次です。

```text
AWS CLI:
  process-payment APIを直接呼ぶ

AWS SDK:
  boto3などからprocess_paymentを呼ぶ

AgentCore SDK:
  PaymentManager.process_payment()

Strands Plugin:
  Toolが402を返したときに内部で支払い処理を呼ぶ
```

CFn/CDKはインフラ定義のための仕組みなので、ProcessPaymentのような実行時処理には使いません。

参考:

- [Process payments with AgentCore Payments](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/payments-processing.html)

### 6.2 x402 payment header生成

x402 payment header生成は、HTTP 402 Payment Requiredレスポンスを読み取り、再リクエストに必要な支払いヘッダーを作る処理です。

AgentCore SDKでは次のメソッドが担当します。

```python
PaymentManager.generate_payment_header()
```

このメソッドは大まかに次を行います。

```text
1. 402レスポンスを検証する
2. x402 payloadを読み取る
3. Instrumentに合うnetwork / assetを選ぶ
4. ProcessPaymentを呼ぶ
5. 支払い証明を受け取る
6. X-PAYMENT または PAYMENT-SIGNATURE ヘッダーを返す
```

AWS CLIやAWS SDKでも低レベルAPIを組み合わせれば実現できますが、x402レスポンスの解析やヘッダー生成を自前で扱う必要があります。そのため、表では「不向き」としています。

Strands Pluginを使う場合は、この処理をPluginが内部で扱います。

参考:

- [Process payments with AgentCore Payments](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/payments-processing.html)

### 6.3 Strands AgentへのPayments組み込み

Strands Agentへの組み込みは、Strands Pluginを使うのが基本です。

主な構成要素は次です。

```python
from bedrock_agentcore.payments.integrations.config import AgentCorePaymentsPluginConfig
from bedrock_agentcore.payments.integrations.strands.plugin import AgentCorePaymentsPlugin
```

設定として主に次を渡します。

```text
payment_manager_arn
payment_connector_id
payment_instrument_id
payment_session_id
user_id
region
network_preferences_config
payment_tool_allowlist
auto_payment
```

Strands Pluginは、Toolの実行結果からHTTP 402を検出し、支払い処理を行い、支払いヘッダー付きでToolを再実行します。

CFn、CDK、AWS CLI、AWS SDKはStrands AgentのPython実装に直接Pluginを組み込むものではありません。そのため、表では不可としています。

AgentCore SDKはPluginの提供元ではありますが、Strands Agentへの組み込みそのものはPluginを使うため、表では「一部可」としています。

参考:

- [Create a Payment Manager and Connector](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/payments-create-manager.html)
- [Process payments with AgentCore Payments](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/payments-processing.html)

## 7. 周辺インフラ

| インフラ項目 | CFn | CDK | AWS CLI | AWS SDK | AgentCore SDK |
| --- | --- | --- | --- | --- | --- |
| Runtime IAM Role作成 | 可 | 可 | 可 | 可 | 不可 |
| Payments用Service Role作成 | 可 | 可 | 可 | 可 | 不可 |
| RuntimeへのPayments権限付与 | 可 | 可 | 可 | 可 | 不可 |
| Runtime環境変数設定 | 可 | 可 | 可 | 可 | 不可 |

## 8. 周辺インフラの詳細

### 8.1 Runtime IAM Role作成

AgentCore RuntimeがBedrockやAgentCore Paymentsを呼ぶには、Runtime IAM Roleが必要です。

これはインフラなので、CDKで管理するのが自然です。

現在のプロジェクトでも、AgentCore RuntimeはCDKで作成しています。

参考:

- [CDK aws_bedrockagentcore module](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_bedrockagentcore-readme.html)

### 8.2 Payments用Service Role作成

PaymentManager作成時には、AgentCore Paymentsが利用するService Roleを指定します。

このRoleはCDKで作るのが自然です。

その後、Role ARNをAgentCore SDKスクリプトへ渡してPaymentManagerを作ります。

```text
CDK:
  Payments用Service Roleを作る

AgentCore SDK:
  role_arnとして渡してPaymentManagerを作る
```

参考:

- [Create a Payment Manager and Connector](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/payments-create-manager.html)

### 8.3 RuntimeへのPayments権限付与

Strands AgentがPaymentsを実行する場合、Runtime IAM RoleにAgentCore PaymentsのData Plane操作権限が必要です。

例:

```text
bedrock-agentcore:ProcessPayment
bedrock-agentcore:CreatePaymentInstrument
bedrock-agentcore:CreatePaymentSession
bedrock-agentcore:GetPaymentInstrument
bedrock-agentcore:ListPaymentInstruments
bedrock-agentcore:GetPaymentSession
bedrock-agentcore:ListPaymentSessions
bedrock-agentcore:GetPaymentInstrumentBalance
```

どこまでRuntimeに許可するかは設計判断です。

本番では、RuntimeがPaymentSessionを自由に作る構成よりも、BackendでPaymentSessionを作成し、Runtimeには支払い処理に必要な権限だけ渡す方が安全です。

一方、このプロジェクトのPoCではDBを使わず、RuntimeがCognito subでInstrumentを検索し、ACTIVEなInstrumentがある場合にPaymentSessionを作成します。そのため、Runtime Roleには `ListPaymentInstruments` と `CreatePaymentSession` も付与します。

参考:

- [Process payments with AgentCore Payments](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/payments-processing.html)

### 8.4 Runtime環境変数設定

Strands AgentのPayments Pluginには、PaymentManager ARN、PaymentInstrument ID、PaymentSession IDなどが必要です。

ただし、このプロジェクトのPoCではPaymentInstrument IDとPaymentSession IDを固定環境変数として渡しません。

Runtime環境変数として渡すのは、初期セットアップ済みの基盤リソースだけです。

例:

```text
PAYMENTS_REGION=us-east-1
PAYMENT_MANAGER_ARN=...
PAYMENT_CONNECTOR_ID=...
```

CDKではRuntimeの環境変数として設定できます。

実行時には、フロントエンドがAmplify sessionから取得したCognito `sub` を
Next.js API経由でAgentCore custom headerとしてRuntimeへ渡し、次を行います。
このcustom headerは、CDKの `requestHeaderConfiguration` でallowlistしておく必要があります。

```text
1. list_payment_instruments(user_id=sub)
2. ACTIVEなInstrumentを選ぶ
3. create_payment_session(user_id=sub)
4. Instrument IDとSession IDでAgentCorePaymentsPluginを構成する
```

本番では、PaymentSession作成をBackendに移し、Runtimeには作成済みSession IDを渡す構成も検討します。

参考:

- [CDK aws_bedrockagentcore module](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_bedrockagentcore-readme.html)
- [Process payments with AgentCore Payments](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/payments-processing.html)

## 9. 実装方針

このプロジェクトでは、まず次の分担にするのがよいです。

```text
CDK:
  AgentCore Runtime
  Runtime IAM Role
  Payments用Service Role
  RuntimeへのPayments権限
  Runtime環境変数

AgentCore SDK scripts:
  PaymentCredentialProvider
  PaymentManager
  PaymentConnector
  PaymentInstrument
  PaymentSession

Strands Agent code:
  AgentCorePaymentsPlugin
  http_request tool
  x402支払いの自動処理
```

PaymentCredentialProviderはCDKでも作れますが、秘密情報の扱いが難しいため、最初はAgentCore SDKスクリプトで作成します。
