# Amplify Gen2 AgentCore Assistant

Single Amplify Gen2 application that contains the Next.js UI, Amplify Auth,
Amplify IaC Hosting, and the AgentCore Strands Python runtime.

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

## Architecture

```text
Browser
  -> Amplify Auth
  -> assistant-ui / AG-UI HttpAgent
  -> Next.js /api/agent
  -> AgentCore Runtime HTTPS endpoint
  -> Strands Python AG-UI runtime
```

`/api/agent` forwards the Cognito access token as
`Authorization: Bearer <accessToken>`. AgentCore Runtime validates the token via
the Cognito/JWT authorizer configured in `amplify/agent-core-stack.ts`.
The frontend also reads the Cognito `sub` from the Amplify session and sends it
through an AgentCore custom header. That header is explicitly allowlisted by
`requestHeaderConfiguration` in `amplify/agent-core-stack.ts`.

## Local Checks

Run commands from the project root:

```bash
cd "/Users/k_miyazaki/Documents/Amplify Gen2 仕組み"
```

```bash
npm run lint
npm run build
npm run agent:typecheck
npm run agent:build
```

The Python Agent Runtime is managed by `uv`, not `requirements.txt`. Install
`uv` before running the agent checks or building the Agent Runtime Docker image.

## Environment Variables

There are two different kinds of environment variables.

`.env.example` is a committed template for `.env.local`. It documents the
Next.js API keys without real values. `.env.local` is the actual local file read
by Next.js; it can contain real local values and is intentionally ignored by git.

`amplify_outputs.json` is also ignored by git in this project. It is generated
for the current Amplify environment and should be recreated by `ampx sandbox` or
deploy workflows instead of being shared as source.

### `.env.local`: Next.js API

Set these in `.env.local` for local development. For deployed frontend hosting,
set them as Amplify Hosting environment variables.

```bash
AGENTCORE_RUNTIME_ARN=arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/YourRuntimeName
AGENTCORE_QUALIFIER=StrandsAgentEndpoint
AWS_REGION=us-east-1
X402_PAY_TO_ADDRESS=0xYourReceivingWalletAddress
X402_FACILITATOR_URL=https://x402.org/facilitator
NEXT_PUBLIC_PRIVY_APP_ID=your-privy-app-id
NEXT_PUBLIC_PRIVY_SIGNER_ID=your-privy-key-quorum-id
```

`NEXT_PUBLIC_PRIVY_APP_ID` and `NEXT_PUBLIC_PRIVY_SIGNER_ID` are public
identifiers used by the signer authorization Tool UI for Privy login and
`addSigners()`. Do not expose the Privy App Secret or Authorization Private Key
to the frontend.

`AGENTCORE_BASE_URL` is optional and normally should not be set. If omitted,
`/api/agent` uses `https://bedrock-agentcore.${AWS_REGION}.amazonaws.com`.
Set it only when you need to call a custom endpoint or local proxy.

Do not put the Payments deploy variables below in `.env.local`; the Next.js API
does not read them.

`X402_PAY_TO_ADDRESS` is used by the test paid API at
`/api/paid/weather`. It must be an EVM receiving wallet address for Base
Sepolia. `X402_FACILITATOR_URL` is optional and defaults to the public testnet
facilitator `https://x402.org/facilitator`.

### `backend.env`: AgentCore Runtime Deploy

For Payments-enabled backend deploys, keep the deploy-time values in
`backend.env`. This file can contain real connector values and is ignored
by git. `backend.env.example` is the committed template.

```bash
cp backend.env.example backend.env
```

Then edit `backend.env`:

```env
AWS_REGION=us-east-1
AMPLIFY_IDENTIFIER=dev
PAYMENT_MANAGER_ARN=arn:aws:bedrock-agentcore:us-east-1:123456789012:payment-manager/your-payment-manager
PAYMENT_CONNECTOR_ID=your-payment-connector-id
PAID_WEATHER_API_URL=https://your-public-domain.example.com/api/paid/weather
```

These values are embedded into the AgentCore Runtime environment by
`amplify/agent-core-stack.ts` at backend deploy time.
The helper scripts derive `CDK_DEFAULT_REGION` and `PAYMENTS_REGION` from
`AWS_REGION`, so there is only one region value to maintain.

`PAID_WEATHER_API_URL` is the public URL that the AgentCore Runtime should call
for the x402 payment validation API. A local URL such as
`http://localhost:3000/api/paid/weather` is not reachable from the deployed
AgentCore Runtime. Use the deployed Amplify Hosting URL or another public URL.

Do not set `PAYMENT_USER_ID`, `PAYMENT_INSTRUMENT_ID`, or
`PAYMENT_SESSION_ID`. The runtime uses the Cognito `sub` custom header as the
Payments `user_id`, looks up an ACTIVE PaymentInstrument at runtime, and creates
a PaymentSession per request when an ACTIVE instrument exists.

## x402 Paid Test API

The app includes a small Coinbase x402-style paid test API:

```text
GET /api/paid/weather
Price: $0.001
Network: Base Sepolia (eip155:84532)
Facilitator: https://x402.org/facilitator by default
```

The route uses `@x402/next` `withX402`, so unauthenticated/unpaid requests
receive a `402 Payment Required` response with payment requirements. After a
valid x402 payment, it returns fixed weather JSON. This is only for validating
AgentCore Payments and Strands Payments Plugin behavior.

To test it from the deployed AgentCore Runtime:

1. Set `X402_PAY_TO_ADDRESS` in Amplify Hosting environment variables.
2. Deploy the frontend hosting.
3. Set `PAID_WEATHER_API_URL` in `backend.env` to the deployed URL, for example
   `https://your-amplify-domain.amplifyapp.com/api/paid/weather`.
4. Redeploy the backend with `npm run amplify:deploy:backend:payments`.
5. Ask the agent to call the paid weather API after explicitly approving the
   test payment.

## Local Development Backend

Start the local development backend. If Payments is disabled, no Payments
variables are needed:

```bash
npx ampx sandbox --identifier dev
```

With Payments enabled, use the deploy env file and run:

```bash
npm run amplify:sandbox:payments
```

Start the Next.js development server separately:

```bash
npm run dev
```

## Manual Deploy From Local Machine

Run all deploy commands from the project root.

Deploy backend resources:

```bash
npm run amplify:deploy:backend
```

When enabling AgentCore Payments for the Agent Runtime, put the Payments values
in `backend.env` and run:

```bash
npm run amplify:deploy:backend:payments
```

After the backend deploy, copy the deployed AgentCore Runtime ARN into
`AGENTCORE_RUNTIME_ARN`. For local development this goes in `.env.local`; for
deployed hosting this goes in Amplify Hosting environment variables.

Deploy frontend hosting:

```bash
npm run amplify:deploy:frontend
```

Deploy both:

```bash
npm run amplify:deploy
```

## Pipeline

Deploy the CI/CD pipeline. This requires a CodeConnections connection ARN and
repository name:

```bash
GITHUB_REPOSITORY_NAME=owner/repo \
CODECONNECTIONS_CONNECTION_ARN=arn:aws:codeconnections:us-east-1:123456789012:connection/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx \
npm run amplify:deploy:pipeline
```

## Important Migration Note

An older standalone CDK stack may already contain an AgentCore Runtime named
`StrandsAgentRuntime`. The current Amplify backend also defines an AgentCore
Runtime with the same name.

Before deploying the integrated Amplify backend, choose one migration path:

```text
Option A:
  Delete the older standalone AgentCore stack, then deploy this integrated
  Amplify backend.

Option B:
  Change runtimeName in amplify/agent-core-stack.ts to create a separate
  AgentCore Runtime.
```

If both stacks try to create `StrandsAgentRuntime`, deployment can fail because
the runtime name is already in use.

## Notes

Deployment concepts and command meanings are documented in
[`docs/amplify-deployment-concepts.md`](docs/amplify-deployment-concepts.md).
`defineHosting` details are documented in
[`docs/define-hosting-codebase-notes.md`](docs/define-hosting-codebase-notes.md).
