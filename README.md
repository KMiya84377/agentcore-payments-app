# AgentCore Payments App

Next.js frontend, Amplify Auth, Amplify IaC Hosting, AgentCore Strands Python
runtime, and Bedrock AgentCore Payments — managed as a single Amplify Gen2
application.

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
│   ├── request_context.py
│   ├── prompts/
│   └── tools/
├── src/app/
│   ├── api/
│   │   ├── agent/route.ts
│   │   └── paid/weather/route.ts
│   ├── components/
│   │   ├── AgentAssistant.tsx
│   │   ├── AgentThread.tsx
│   │   ├── AssistantRuntimeProvider.tsx
│   │   ├── paymentToolkit.ts
│   │   └── payment-tools/
│   │       ├── PaymentToolCall.tsx
│   │       └── WalletAuthorizationTool.tsx
│   └── providers/
│       ├── AmplifyAuthProvider.tsx
│       └── PrivyAppProvider.tsx
├── scripts/
├── cdk.json
└── package.json
```

## Architecture

```text
Browser
  -> Amplify Auth (Cognito)
  -> assistant-ui / AG-UI HttpAgent
  -> Next.js /api/agent
  -> AgentCore Runtime HTTPS endpoint
  -> Strands Python AG-UI runtime
       -> AgentCore Payments Plugin
            -> /api/paid/weather (x402 paid endpoint)
```

`/api/agent` forwards the Cognito access token as
`Authorization: Bearer <accessToken>` and the Cognito `sub` and email as
AgentCore custom headers. AgentCore Runtime validates the token via the
Cognito/JWT authorizer and uses the `sub` as the Payments `user_id`.

The frontend uses Privy for wallet authorization. `WalletAuthorizationTool`
handles the in-chat `addSigners()` flow so the agent can initiate x402 payments.

## Local Checks

```bash
npm run lint
npm run build
npm run agent:typecheck
npm run agent:build
```

The Python Agent Runtime is managed by `uv`. Install `uv` before running agent
checks or building the Docker image.

## Environment Variables

### `.env.local` — Next.js API

Used for local development. For deployed hosting, set these as Amplify Hosting
environment variables.

```bash
AGENTCORE_RUNTIME_ARN=arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/YourRuntimeName
AGENTCORE_QUALIFIER=StrandsAgentEndpoint
AWS_REGION=us-east-1
X402_PAY_TO_ADDRESS=0xYourReceivingWalletAddress
X402_FACILITATOR_URL=https://x402.org/facilitator   # optional
NEXT_PUBLIC_PRIVY_APP_ID=your-privy-app-id
NEXT_PUBLIC_PRIVY_SIGNER_ID=your-privy-key-quorum-id
```

`NEXT_PUBLIC_PRIVY_APP_ID` and `NEXT_PUBLIC_PRIVY_SIGNER_ID` are public
identifiers used by the in-chat wallet authorization UI. Do not expose the
Privy App Secret or Authorization Private Key to the frontend.

`AGENTCORE_BASE_URL` is optional. If omitted, `/api/agent` defaults to
`https://bedrock-agentcore.${AWS_REGION}.amazonaws.com`.

### `backend.env` — AgentCore Runtime Deploy

For Payments-enabled backend deploys only. This file contains real connector
values and is ignored by git. Create it locally before running Payments scripts:

```bash
cp backend.env.example backend.env   # backend.env.example is also gitignored — create manually
```

```env
AWS_REGION=us-east-1
AMPLIFY_IDENTIFIER=dev
PAYMENT_MANAGER_ARN=arn:aws:bedrock-agentcore:us-east-1:123456789012:payment-manager/your-payment-manager
PAYMENT_CONNECTOR_ID=your-payment-connector-id
PAID_WEATHER_API_URL=https://your-public-domain.example.com/api/paid/weather
```

`PAYMENT_USER_ID`, `PAYMENT_INSTRUMENT_ID`, and `PAYMENT_SESSION_ID` are
not set here — the runtime resolves them dynamically at request time using the
Cognito `sub` header.

## x402 Paid Test API

```text
GET /api/paid/weather
Price:     $0.001
Network:   Base Sepolia (eip155:84532)
Facilitator: https://x402.org/facilitator (default)
```

Protected by `@x402/next` `withX402`. Unpaid requests receive
`402 Payment Required`. After a valid x402 payment, it returns fixed weather
JSON. Purpose: end-to-end validation of AgentCore Payments and the Strands
Payments Plugin.

To test from the deployed AgentCore Runtime:

1. Set `X402_PAY_TO_ADDRESS` in Amplify Hosting environment variables.
2. Deploy the frontend.
3. Set `PAID_WEATHER_API_URL` in `backend.env` to the deployed URL.
4. Redeploy the backend: `npm run amplify:deploy:backend:payments`.
5. Ask the agent to call the paid weather API after explicitly approving the payment.

## Local Development

Start the Amplify sandbox (Payments disabled):

```bash
npx ampx sandbox --identifier dev
```

With Payments enabled:

```bash
npm run amplify:sandbox:payments
```

Start the Next.js dev server separately:

```bash
npm run dev
```

## Deploy

Deploy backend only:

```bash
npm run amplify:deploy:backend
```

Deploy backend with Payments (requires `backend.env`):

```bash
npm run amplify:deploy:backend:payments
```

Deploy frontend only:

```bash
npm run amplify:deploy:frontend
```

Deploy both:

```bash
npm run amplify:deploy
```

## Pipeline

Requires a CodeConnections connection ARN and the GitHub repository name:

```bash
GITHUB_REPOSITORY_NAME=owner/repo \
CODECONNECTIONS_CONNECTION_ARN=arn:aws:codeconnections:us-east-1:123456789012:connection/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx \
npm run amplify:deploy:pipeline
```

## Migration Note

An older standalone CDK stack may already contain an AgentCore Runtime named
`StrandsAgentRuntime`. The Amplify backend defines a Runtime with the same
name. Before deploying, choose one path:

- **Option A** — Delete the old standalone stack, then deploy this Amplify backend.
- **Option B** — Change `runtimeName` in `amplify/agent-core-stack.ts` to avoid the name collision.
