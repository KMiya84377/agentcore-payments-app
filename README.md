# AgentCore Payments App

Amazon Bedrock AgentCore Payments を使って、AI エージェントが自律的に決済を実行するデモアプリです。

ユーザーが Privy ウォレットを承認すると、エージェントは x402 プロトコルで有料 API を呼び出し、USDC マイクロペイメントを自動処理します。Stripe（Privy）と Coinbase CDP の両ベンダーに対応しています。

## Architecture

```text
Browser
  -> Amplify Auth (Cognito)
  -> assistant-ui / AG-UI HttpAgent
  -> Next.js /api/agent
  -> AgentCore Runtime (Strands Python)
       -> AgentCore Payments Plugin (Stripe/Coinbase)
            -> /api/paid/weather  (x402 paid endpoint, $0.001 USDC)
```

- **認証**: Cognito JWT を AgentCore Runtime に転送し、Cognito `sub` を Payments の `user_id` として使用
- **ウォレット承認**: チャット内の `WalletAuthorizationTool` で Privy `addSigners()` を実行し、エージェントへの署名権限を付与
- **決済フロー**: エージェントが x402 の `402 Payment Required` を受け取ると、Payments Plugin が自動的に USDC 決済を処理して再リクエスト

## Repository Structure

```text
.
├── amplify/
│   ├── auth/resource.ts          # Cognito 設定
│   ├── backend.ts
│   ├── hosting.ts
│   ├── pipeline.ts
│   └── agent-core-stack.ts       # AgentCore Runtime + Payments CDK 定義
├── agent-runtime/
│   ├── Dockerfile
│   ├── pyproject.toml
│   ├── uv.lock
│   ├── app.py                    # FastAPI + Strands AG-UI エントリーポイント
│   ├── request_context.py
│   ├── prompts/system_prompt.md
│   └── tools/payments.py         # PaymentInstrument / Session 操作ツール
├── src/app/
│   ├── api/
│   │   ├── agent/route.ts        # AgentCore Runtime へのプロキシ
│   │   └── paid/weather/route.ts # x402 保護の有料テスト API
│   ├── components/
│   │   ├── AgentAssistant.tsx
│   │   ├── AgentThread.tsx
│   │   ├── AssistantRuntimeProvider.tsx
│   │   ├── paymentToolkit.ts
│   │   └── payment-tools/
│   │       ├── PaymentToolCall.tsx
│   │       └── WalletAuthorizationTool.tsx
│   ├── providers/
│   │   ├── AmplifyAuthProvider.tsx
│   │   └── PrivyAppProvider.tsx
│   └── providers.tsx
├── scripts/
│   ├── sandbox-payments.sh
│   ├── deploy-backend-payments.sh
│   ├── resolve-payment-credential-provider-arn.py
│   └── resolve-payment-service-role-name.py
├── cdk.json
└── package.json
```

## Local Checks

```bash
npm run lint
npm run build
npm run agent:typecheck
npm run agent:build
```

Python Agent Runtime は `uv` で管理しています。agent コマンドの実行前に `uv` をインストールしてください。

## Environment Variables

### `.env.local` — Next.js API

ローカル開発時は `.env.local` に設定します。デプロイ済み hosting では Amplify Hosting の環境変数として設定します。

```bash
AGENTCORE_RUNTIME_ARN=arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/YourRuntimeName
AGENTCORE_QUALIFIER=StrandsAgentEndpoint
AWS_REGION=us-east-1
X402_PAY_TO_ADDRESS=0xYourReceivingWalletAddress
X402_FACILITATOR_URL=https://x402.org/facilitator   # optional
NEXT_PUBLIC_PRIVY_APP_ID=your-privy-app-id
NEXT_PUBLIC_PRIVY_SIGNER_ID=your-privy-key-quorum-id
```

`NEXT_PUBLIC_PRIVY_APP_ID` と `NEXT_PUBLIC_PRIVY_SIGNER_ID` はチャット内のウォレット承認 UI が使う公開識別子です。Privy App Secret と Authorization Private Key はフロントエンドに設定しません。

`AGENTCORE_BASE_URL` は任意です。未設定の場合 `/api/agent` は `https://bedrock-agentcore.${AWS_REGION}.amazonaws.com` を使います。

### `backend.env` — AgentCore Runtime Deploy

Payments 有効の backend deploy 時のみ必要です。実際の connector 値を含むため git から除外しています。実行前に手動で作成してください。

```env
AWS_REGION=us-east-1
AMPLIFY_IDENTIFIER=dev
PAYMENT_MANAGER_ARN=arn:aws:bedrock-agentcore:us-east-1:123456789012:payment-manager/your-payment-manager
PAYMENT_CONNECTOR_ID=your-payment-connector-id
PAID_WEATHER_API_URL=https://your-public-domain.example.com/api/paid/weather
```

`PAYMENT_USER_ID`・`PAYMENT_INSTRUMENT_ID`・`PAYMENT_SESSION_ID` は設定不要です。Runtime がリクエストごとに Cognito `sub` を `user_id` として使い、動的に解決します。

## x402 Paid Test API

```text
GET /api/paid/weather
Price:      $0.001 USDC
Network:    Base Sepolia (eip155:84532)
Facilitator: https://x402.org/facilitator (default)
```

`@x402/next` の `withX402` で保護されています。未払いリクエストには `402 Payment Required` を返し、有効な x402 payment がある場合のみ固定の天気 JSON を返します。AgentCore Payments と Strands Payments Plugin の E2E 疎通確認用エンドポイントです。

デプロイ済み Runtime から検証する手順:

1. Amplify Hosting の環境変数に `X402_PAY_TO_ADDRESS` を設定
2. frontend をデプロイ
3. `backend.env` の `PAID_WEATHER_API_URL` にデプロイ後の URL を設定
4. `npm run amplify:deploy:backend:payments` で backend を再デプロイ
5. チャットで支払い検証を明示的に許可し、エージェントに有料天気 API を呼ばせる

## Local Development

Sandbox 起動（Payments なし）:

```bash
npx ampx sandbox --identifier dev
```

Payments 有効の場合（`backend.env` 要）:

```bash
npm run amplify:sandbox:payments
```

Next.js dev server を別ターミナルで起動:

```bash
npm run dev
```

## Deploy

```bash
# backend のみ
npm run amplify:deploy:backend

# backend + Payments（backend.env 要）
npm run amplify:deploy:backend:payments

# frontend のみ
npm run amplify:deploy:frontend

# 両方
npm run amplify:deploy
```

## Pipeline

```bash
GITHUB_REPOSITORY_NAME=owner/repo \
CODECONNECTIONS_CONNECTION_ARN=arn:aws:codeconnections:us-east-1:123456789012:connection/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx \
npm run amplify:deploy:pipeline
```

## Migration Note

既存の standalone CDK stack に `StrandsAgentRuntime` という AgentCore Runtime が存在する場合、この Amplify backend と名前が衝突します。デプロイ前に次のどちらかを選択してください。

- **Option A** — 古い standalone stack を削除してからデプロイ
- **Option B** — `amplify/agent-core-stack.ts` の `runtimeName` を変更して別名で作成
