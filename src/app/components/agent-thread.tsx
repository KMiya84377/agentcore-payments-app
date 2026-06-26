"use client";

import {
  AuiIf,
  ComposerPrimitive,
  ErrorPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useMessage,
} from "@assistant-ui/react";
import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import { useAuthenticator } from "@aws-amplify/ui-react";
import remarkGfm from "remark-gfm";
import { PaymentToolCall } from "./payment-tools/payment-tool-call";

function AssistantMarkdown() {
  return (
    <MarkdownTextPrimitive
      className="markdown"
      remarkPlugins={[remarkGfm]}
    />
  );
}

function AssistantLoading() {
  const shouldShow = useMessage((message) => {
    if (message.status?.type !== "running") return false;

    return !message.content.some((part) => {
      if (part.type === "text") return part.text.trim().length > 0;
      return part.type === "tool-call";
    });
  });

  if (!shouldShow) return null;

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
        <MessagePrimitive.Parts>
          {({ part }) => {
            if (part.type === "text") return <AssistantMarkdown />;
            if (part.type !== "tool-call") return null;

            return part.toolUI ?? <PaymentToolCall {...part} />;
          }}
        </MessagePrimitive.Parts>
        <AssistantLoading />
        <MessagePrimitive.Error>
          <ErrorPrimitive.Root className="message-error">
            <ErrorPrimitive.Message />
          </ErrorPrimitive.Root>
        </MessagePrimitive.Error>
      </div>
    </MessagePrimitive.Root>
  );
}

function UserMessage() {
  return (
    <MessagePrimitive.Root className="message message-user">
      <div className="message-content">
        <MessagePrimitive.Parts />
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
      <AuiIf condition={(state) => !state.thread.isRunning}>
        <ComposerPrimitive.Send
          className="composer-send"
          aria-label="メッセージを送信"
          data-testid="payment-agent-send"
        >
          <span aria-hidden="true">↑</span>
        </ComposerPrimitive.Send>
      </AuiIf>
      <AuiIf condition={(state) => state.thread.isRunning}>
        <ComposerPrimitive.Cancel
          className="composer-send"
          aria-label="応答を停止"
          data-testid="payment-agent-cancel"
        >
          <span aria-hidden="true">■</span>
        </ComposerPrimitive.Cancel>
      </AuiIf>
    </ComposerPrimitive.Root>
  );
}

export function AgentThread() {
  const { signOut } = useAuthenticator((context) => [context.user]);

  return (
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
          <AuiIf condition={(state) => state.thread.isEmpty}>
            <section className="empty-state">
              <p className="empty-kicker">Payment assistant</p>
              <h2>ウォレットと支払いを確認する</h2>
              <p>
                ウォレットの状態やUSDC残高を確認しながら、必要な操作をチャットで進めます。
              </p>
            </section>
          </AuiIf>
          <ThreadPrimitive.Messages>
            {({ message }) =>
              message.role === "user" ? (
                <UserMessage />
              ) : (
                <AssistantMessage />
              )
            }
          </ThreadPrimitive.Messages>
          <ThreadPrimitive.ViewportFooter className="thread-footer">
            <Composer />
          </ThreadPrimitive.ViewportFooter>
        </ThreadPrimitive.Viewport>
      </ThreadPrimitive.Root>
    </main>
  );
}
