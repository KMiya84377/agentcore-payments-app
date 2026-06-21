"use client";

import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  type TextMessagePartComponent,
  type ToolCallMessagePartComponent,
  useMessage,
} from "@assistant-ui/react";
import { useAgUiRuntime } from "@assistant-ui/react-ag-ui";
import { HttpAgent } from "@ag-ui/client";
import { useAuthenticator } from "@aws-amplify/ui-react";
import {
  useLogin,
  usePrivy,
  useSigners,
  type WalletWithMetadata,
} from "@privy-io/react-auth";
import { fetchAuthSession } from "aws-amplify/auth";
import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const AGENTCORE_USER_SUB_HEADER =
  "X-Amzn-Bedrock-AgentCore-Runtime-Custom-User-Sub";
const AGENTCORE_USER_EMAIL_HEADER =
  "X-Amzn-Bedrock-AgentCore-Runtime-Custom-User-Email";
const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
const PRIVY_SIGNER_ID = process.env.NEXT_PUBLIC_PRIVY_SIGNER_ID;

const paymentToolLabels: Record<string, string> = {
  list_payment_instruments: "支払いインストゥルメントを確認",
  create_payment_instrument: "支払いインストゥルメントを作成",
  get_payment_instrument_balance: "残高を確認",
  create_payment_session: "支払いセッションを作成",
  request_wallet_authorization: "Agentへの支払い権限を確認",
};

type WalletAuthorizationResult = {
  status: string;
  paymentInstrumentId?: string;
  walletAddress?: string;
  network?: string | null;
  message?: string;
};

function parseWalletAuthorizationResult(
  value: unknown,
): WalletAuthorizationResult | null {
  if (typeof value === "string") {
    try {
      return parseWalletAuthorizationResult(JSON.parse(value));
    } catch {
      return null;
    }
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const result = parseWalletAuthorizationResult(item);
      if (result) return result;
    }
    return null;
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;

  if (typeof record.status === "string") {
    return record as WalletAuthorizationResult;
  }

  for (const item of Object.values(record)) {
    const result = parseWalletAuthorizationResult(item);
    if (result) return result;
  }

  return null;
}

function abbreviateAddress(address: string) {
  return `${address.slice(0, 8)}...${address.slice(-6)}`;
}

function WalletAuthorizationWithPrivy({
  walletAddress,
  paymentInstrumentId,
  network,
}: {
  walletAddress: string;
  paymentInstrumentId?: string;
  network?: string | null;
}) {
  const { ready, authenticated, user } = usePrivy();
  const { login } = useLogin();
  const { addSigners } = useSigners();
  const [state, setState] = useState<
    "idle" | "authorizing" | "authorized" | "error"
  >("idle");
  const [error, setError] = useState<string | null>(null);

  const authorize = async () => {
    setError(null);

    if (!authenticated) {
      login();
      return;
    }

    const wallet = user?.linkedAccounts.find(
      (account): account is WalletWithMetadata =>
        account.type === "wallet" &&
        account.walletClientType === "privy" &&
        account.address.toLowerCase() === walletAddress.toLowerCase(),
    );

    if (!wallet) {
      setState("error");
      setError(
        "Privyにログインしたアカウントに対象ウォレットがありません。Instrument作成時と同じユーザーでログインしてください。",
      );
      return;
    }

    setState("authorizing");

    try {
      await addSigners({
        address: wallet.address,
        signers: [{ signerId: PRIVY_SIGNER_ID!, policyIds: [] }],
      });
      setState("authorized");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);

      if (message.toLowerCase().includes("already")) {
        setState("authorized");
        return;
      }

      setState("error");
      setError(message);
    }
  };

  return (
    <section className="authorization-card">
      <div className="authorization-card-header">
        <div>
          <p className="authorization-kicker">Privy authorization</p>
          <h3>Agentに支払い権限を付与</h3>
        </div>
        <span className={`authorization-status authorization-status-${state}`}>
          {state === "authorized"
            ? "承認済み"
            : state === "authorizing"
              ? "承認中"
              : "未承認"}
        </span>
      </div>
      <p className="authorization-description">
        AgentCoreがこのウォレットで支払い証明を作成できるよう、PrivyでSignerを追加します。
      </p>
      <p className="authorization-notice">
        現在は検証用のため、SignerにPrivy Policyの取引制限は設定していません。
      </p>
      <dl className="authorization-details">
        <div>
          <dt>Wallet</dt>
          <dd>{abbreviateAddress(walletAddress)}</dd>
        </div>
        {network ? (
          <div>
            <dt>Network</dt>
            <dd>{network}</dd>
          </div>
        ) : null}
        {paymentInstrumentId ? (
          <div>
            <dt>Instrument</dt>
            <dd>{paymentInstrumentId}</dd>
          </div>
        ) : null}
      </dl>
      {error ? (
        <p className="authorization-error" role="alert">
          {error}
        </p>
      ) : null}
      {state === "authorized" ? (
        <p className="authorization-success" role="status">
          Signerを追加しました。この権限は以後のProcessPaymentで使用されます。
        </p>
      ) : (
        <button
          type="button"
          className="authorization-button"
          disabled={!ready || state === "authorizing"}
          onClick={authorize}
        >
          {!ready
            ? "Privyを準備中"
            : !authenticated
              ? "Privyにログイン"
              : state === "authorizing"
                ? "承認処理中"
                : "支払い権限を付与"}
        </button>
      )}
    </section>
  );
}

const WalletAuthorizationTool: ToolCallMessagePartComponent = ({
  status,
  result,
  isError,
}) => {
  if (status.type === "running" || status.type === "requires-action") {
    return (
      <div className="tool-call">
        <span className="tool-call-dot" aria-hidden="true" />
        <span className="tool-call-name">Walletの承認情報を確認</span>
        <span className="tool-call-status">実行中</span>
      </div>
    );
  }

  const authorization = parseWalletAuthorizationResult(result);

  if (
    isError ||
    !authorization ||
    authorization.status !== "authorization_required" ||
    !authorization.walletAddress
  ) {
    return (
      <div className="authorization-card authorization-card-error">
        <h3>承認を開始できません</h3>
        <p>
          {authorization?.message ??
            "Walletの承認に必要な情報を取得できませんでした。"}
        </p>
      </div>
    );
  }

  if (!PRIVY_APP_ID || !PRIVY_SIGNER_ID) {
    return (
      <div className="authorization-card authorization-card-error">
        <h3>Privyの設定が必要です</h3>
        <p>
          NEXT_PUBLIC_PRIVY_APP_IDとNEXT_PUBLIC_PRIVY_SIGNER_IDをWebアプリに設定してください。
        </p>
      </div>
    );
  }

  return (
    <WalletAuthorizationWithPrivy
      walletAddress={authorization.walletAddress}
      paymentInstrumentId={authorization.paymentInstrumentId}
      network={authorization.network}
    />
  );
};

const PaymentToolCall: ToolCallMessagePartComponent = ({
  toolName,
  status,
  isError,
}) => {
  const label = paymentToolLabels[toolName] ?? toolName;
  const failed = isError || status.type === "incomplete";
  const statusLabel =
    status.type === "running" || status.type === "requires-action"
      ? "実行中"
      : failed
        ? "失敗"
        : "完了";

  return (
    <div className={`tool-call ${failed ? "tool-call-error" : ""}`}>
      <span className="tool-call-dot" aria-hidden="true" />
      <span className="tool-call-name">{label}</span>
      <span className="tool-call-status">{statusLabel}</span>
    </div>
  );
};

const AssistantMarkdown: TextMessagePartComponent = ({ text }) => {
  if (!text) {
    return null;
  }

  return (
    <div className="markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
};

function AssistantLoading() {
  const shouldShow = useMessage((message) => {
    if (message.status?.type !== "running") {
      return false;
    }

    return !message.content.some((part) => {
      if (part.type === "text") {
        return part.text.trim().length > 0;
      }

      return part.type === "tool-call" || part.type === "reasoning";
    });
  });

  if (!shouldShow) {
    return null;
  }

  return (
    <div className="assistant-loading" role="status" aria-live="polite">
      <span className="loading-dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      <span>応答を準備しています</span>
    </div>
  );
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="message message-assistant">
      <div className="avatar" aria-hidden="true">
        A
      </div>
      <div className="message-content">
        <MessagePrimitive.Content
          components={{
            Text: AssistantMarkdown,
            tools: {
              by_name: {
                request_wallet_authorization: WalletAuthorizationTool,
              },
              Fallback: PaymentToolCall,
            },
          }}
        />
        <AssistantLoading />
      </div>
    </MessagePrimitive.Root>
  );
}

function UserMessage() {
  return (
    <MessagePrimitive.Root className="message message-user">
      <div className="message-content">
        <MessagePrimitive.Content />
      </div>
    </MessagePrimitive.Root>
  );
}

function Composer() {
  return (
    <ComposerPrimitive.Root className="composer" data-testid="payment-composer">
      <label className="sr-only" htmlFor="payment-agent-input">
        決済エージェントへのメッセージ
      </label>
      <ComposerPrimitive.Input
        id="payment-agent-input"
        className="composer-input"
        aria-label="決済エージェントへのメッセージ"
        data-testid="payment-agent-input"
        placeholder="決済についてメッセージを送信"
        rows={1}
      />
      <ComposerPrimitive.Send
        className="composer-send"
        aria-label="メッセージを送信"
        data-testid="payment-agent-send"
      >
        <span aria-hidden="true">↑</span>
      </ComposerPrimitive.Send>
    </ComposerPrimitive.Root>
  );
}

export function AgentAssistant() {
  const { signOut } = useAuthenticator((context) => [context.user]);

  const agent = useMemo(
    () =>
      new HttpAgent({
        url: "/api/agent",
        fetch: async (url, requestInit) => {
          const session = await fetchAuthSession();
          const accessToken = session.tokens?.accessToken?.toString();
          const userSub =
            session.tokens?.idToken?.payload.sub ??
            session.tokens?.accessToken?.payload.sub;
          const userEmail = session.tokens?.idToken?.payload.email;
          const headers = new Headers(requestInit?.headers);

          if (accessToken) {
            headers.set("Authorization", `Bearer ${accessToken}`);
          }

          if (typeof userSub === "string") {
            headers.set(AGENTCORE_USER_SUB_HEADER, userSub);
          }

          if (typeof userEmail === "string") {
            headers.set(AGENTCORE_USER_EMAIL_HEADER, userEmail);
          }

          return window.fetch(url, {
            ...requestInit,
            headers,
          });
        },
      }),
    [],
  );
  
  const runtime = useAgUiRuntime({ agent });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <main className="assistant-shell">
        <header className="app-header">
          <div>
            <p className="eyebrow">AgentCore Payments</p>
            <h1>決済エージェント</h1>
          </div>
          <div className="account">
            <span>ログイン中</span>
            <button type="button" onClick={signOut}>
              Sign out
            </button>
          </div>
        </header>

        <ThreadPrimitive.Root className="thread">
          <ThreadPrimitive.Viewport className="thread-viewport">
            <ThreadPrimitive.Empty>
              <section className="empty-state">
                <p className="empty-kicker">Payment assistant</p>
                <h2>ウォレットと支払いを確認する</h2>
                <p>
                  ウォレットの状態やUSDC残高を確認しながら、必要な操作をチャットで進めます。
                </p>
              </section>
            </ThreadPrimitive.Empty>
            <ThreadPrimitive.Messages
              components={{
                UserMessage,
                AssistantMessage,
              }}
            />
            <ThreadPrimitive.ViewportFooter className="thread-footer">
              <Composer />
            </ThreadPrimitive.ViewportFooter>
          </ThreadPrimitive.Viewport>
        </ThreadPrimitive.Root>
      </main>
    </AssistantRuntimeProvider>
  );
}
