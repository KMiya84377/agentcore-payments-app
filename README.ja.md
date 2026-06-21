# Amplify Gen2 AgentCore Assistant

Next.js UI、Amplify Auth、Amplify IaC Hosting、AgentCore Strands Python Runtime を
1つの Amplify Gen2 アプリケーションとして管理するプロジェクトです。

```text
.
├── amplify/
│   ├── auth/resource.ts
│   ├── backend.ts
│   ├── pipeline.ts
│   ├── hosting.ts
│   └── agent-core-stack.ts
├── agent-runtime/
│   ├── Dockerfile
│   ├── pyproject.toml
│   ├── uv.lock
│   ├── app.py
│   ├── prompts/
│   └── tools/
├── src/app/
│   ├── api/agent/route.ts
│   ├── components/agent-assistant.tsx
│   └── providers.tsx
├── cdk.json
└── package.json
```

## 構成

```text
Browser
  -> Amplify Auth
  -> assistant-ui / AG-UI HttpAgent
  -> Next.js /api/agent
  -> AgentCore Runtime HTTPS endpoint
  -> Strands Python AG-UI runtime
```

`/api/agent` は Cognito access token を
`Authorization: Bearer <accessToken>` として AgentCore Runtime に転送します。
AgentCore Runtime 側では、`amplify/agent-core-stack.ts` で設定した
Cognito/JWT authorizer が token を検証します。

また、フロントエンドは Amplify session から Cognito `sub` を取得し、
AgentCore custom header として送信します。この custom header は
`amplify/agent-core-stack.ts` の `requestHeaderConfiguration` で明示的に
allowlist しています。

## ローカルチェック

プロジェクトルートで実行します。

```bash
cd "/Users/k_miyazaki/Documents/Amplify Gen2 仕組み"
```

```bash
npm run lint
npm run build
npm run agent:typecheck
npm run agent:build
```

Python Agent Runtime は `requirements.txt` ではなく `uv` で管理します。
Agent Runtime のチェックや Docker image build の前に `uv` をインストールしてください。

## 環境変数

環境変数は大きく2種類あります。

`.env.example` は、`.env.local` 用のテンプレートです。Next.js API が読むキーだけを
実値なしで記載し、git に含めます。

`.env.local` は、Next.js がローカル実行時に読み込む実ファイルです。実際のARNや
ローカル用の値を入れるため、git から除外します。

このプロジェクトでは `amplify_outputs.json` も git から除外します。これは現在の
Amplify 環境に対して生成されるファイルなので、ソースとして共有するのではなく、
`ampx sandbox` や deploy workflow で再生成します。

### `.env.local`: Next.js API 用

ローカル開発では `.env.local` に設定します。
デプロイ済み frontend hosting では Amplify Hosting の環境変数として設定します。

```bash
AGENTCORE_RUNTIME_ARN=arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/YourRuntimeName
AGENTCORE_QUALIFIER=StrandsAgentEndpoint
AWS_REGION=us-east-1
X402_PAY_TO_ADDRESS=0xYourReceivingWalletAddress
X402_FACILITATOR_URL=https://x402.org/facilitator
NEXT_PUBLIC_PRIVY_APP_ID=your-privy-app-id
NEXT_PUBLIC_PRIVY_SIGNER_ID=your-privy-key-quorum-id
```

`NEXT_PUBLIC_PRIVY_APP_ID` と `NEXT_PUBLIC_PRIVY_SIGNER_ID` は、チャット内の
Signer 承認 Tool UI が Privy ログインと `addSigners()` に使う公開識別子です。
Privy App Secret と Authorization Private Key はフロントエンドに設定しません。

`AGENTCORE_BASE_URL` は任意で、通常は設定不要です。未設定の場合、`/api/agent` は次を使います。

```text
https://bedrock-agentcore.${AWS_REGION}.amazonaws.com
```

カスタムエンドポイントやローカルプロキシを使う場合だけ設定します。

下の Payments 用 deploy 変数は `.env.local` には入れません。Next.js API は読みません。

`X402_PAY_TO_ADDRESS` は、テスト用有料API `/api/paid/weather` の受取先アドレスです。
Base Sepolia で受け取れる EVM ウォレットアドレスを指定します。
`X402_FACILITATOR_URL` は任意です。未設定の場合はテスト用 facilitator の
`https://x402.org/facilitator` を使います。

### `backend.env`: AgentCore Runtime deploy 用

Payments 有効の backend deploy では、deploy 時に使う値を `backend.env` に置きます。
このファイルは実際の connector 値を含むため git から除外します。
git に含めるのはテンプレートの `backend.env.example` だけです。

```bash
cp backend.env.example backend.env
```

その後、`backend.env` を編集します。

```env
AWS_REGION=us-east-1
AMPLIFY_IDENTIFIER=dev
PAYMENT_MANAGER_ARN=arn:aws:bedrock-agentcore:us-east-1:123456789012:payment-manager/your-payment-manager
PAYMENT_CONNECTOR_ID=your-payment-connector-id
PAID_WEATHER_API_URL=https://your-public-domain.example.com/api/paid/weather
```

これらは `amplify/agent-core-stack.ts` によって AgentCore Runtime の環境変数として
backend deploy 時に埋め込まれます。
helper script が `AWS_REGION` から `CDK_DEFAULT_REGION` と `PAYMENTS_REGION` を設定するため、
管理する region は1つだけです。

`PAID_WEATHER_API_URL` は、AgentCore Runtime が呼び出す x402 支払い検証用APIの公開URLです。
デプロイ済み AgentCore Runtime からは `http://localhost:3000/api/paid/weather` は見えません。
Amplify Hosting の公開URL、または別の公開URLを指定してください。

次の値は固定環境変数として設定しません。

```text
PAYMENT_USER_ID
PAYMENT_INSTRUMENT_ID
PAYMENT_SESSION_ID
```

Runtime は Cognito `sub` custom header を AgentCore Payments の `user_id` として使います。
ACTIVE な PaymentInstrument は実行時に検索し、ACTIVE instrument がある場合に
リクエストごとに PaymentSession を作成します。

## x402 支払い検証API

このアプリには、Coinbase x402 の公式Quickstartに近い小さな有料APIを含めています。

```text
GET /api/paid/weather
価格: $0.001
ネットワーク: Base Sepolia (eip155:84532)
Facilitator: 既定では https://x402.org/facilitator
```

この route は `@x402/next` の `withX402` で保護しています。
未払いのリクエストには `402 Payment Required` と支払い要件が返ります。
有効な x402 payment がある場合だけ、固定の天気JSONを返します。
目的は AgentCore Payments と Strands Payments Plugin の疎通確認です。

デプロイ済み AgentCore Runtime から検証する流れは次の通りです。

1. Amplify Hosting の環境変数に `X402_PAY_TO_ADDRESS` を設定する
2. frontend hosting をデプロイする
3. `backend.env` の `PAID_WEATHER_API_URL` に、デプロイ後のURLを設定する
   例: `https://your-amplify-domain.amplifyapp.com/api/paid/weather`
4. `npm run amplify:deploy:backend:payments` で backend を再デプロイする
5. チャットで、明示的に支払い検証を許可したうえで、Agent に有料天気APIを呼ばせる

## ローカル開発 Backend

ローカル開発用 backend を起動します。Payments を無効にする場合、Payments 用の環境変数は不要です。

```bash
npx ampx sandbox --identifier dev
```

Payments を有効にする場合は、`backend.env` に値を入れてから実行します。

```bash
npm run amplify:sandbox:payments
```

Next.js の開発サーバーは別で起動します。

```bash
npm run dev
```

## 手元からのデプロイ

すべてプロジェクトルートで実行します。

backend resources をデプロイします。

```bash
npm run amplify:deploy:backend
```

AgentCore Payments を有効にする場合は、Payments の値を `backend.env` に入れてから実行します。

```bash
npm run amplify:deploy:backend:payments
```

backend deploy 後、作成された AgentCore Runtime ARN を `AGENTCORE_RUNTIME_ARN` に設定します。
ローカル開発では `.env.local`、デプロイ済み hosting では Amplify Hosting 環境変数に設定します。

frontend hosting をデプロイします。

```bash
npm run amplify:deploy:frontend
```

backend と frontend の両方をデプロイします。

```bash
npm run amplify:deploy
```

## Pipeline

CI/CD pipeline をデプロイします。CodeConnections connection ARN と repository name が必要です。

```bash
GITHUB_REPOSITORY_NAME=owner/repo \
CODECONNECTIONS_CONNECTION_ARN=arn:aws:codeconnections:us-east-1:123456789012:connection/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx \
npm run amplify:deploy:pipeline
```

## 重要な移行メモ

以前の standalone CDK stack に、すでに `StrandsAgentRuntime` という
AgentCore Runtime が存在している可能性があります。
現在の Amplify backend も同じ名前の AgentCore Runtime を定義しています。

統合済み Amplify backend をデプロイする前に、次のどちらかを選びます。

```text
Option A:
  古い standalone AgentCore stack を削除してから、
  この統合済み Amplify backend をデプロイする。

Option B:
  amplify/agent-core-stack.ts の runtimeName を変更し、
  別名の AgentCore Runtime として作成する。
```

両方の stack が `StrandsAgentRuntime` を作ろうとすると、Runtime 名の重複で
デプロイに失敗する可能性があります。

## 補足

デプロイ方式やコマンドの意味は
[`docs/amplify-deployment-concepts.md`](docs/amplify-deployment-concepts.md)
に整理しています。
`defineHosting` のコードベース上の仕組みは
[`docs/define-hosting-codebase-notes.md`](docs/define-hosting-codebase-notes.md)
に整理しています。
