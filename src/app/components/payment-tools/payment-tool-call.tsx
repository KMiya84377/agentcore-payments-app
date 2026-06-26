"use client";

import { type ToolCallMessagePartComponent } from "@assistant-ui/react";
import { formatToolValue } from "./tool-format";

const paymentToolLabels: Record<string, string> = {
  list_payment_instruments: "支払いインストゥルメントを確認",
  get_payment_instrument: "支払いインストゥルメントの詳細を確認",
  create_payment_instrument: "支払いインストゥルメントを作成",
  delete_payment_instrument: "支払いインストゥルメントを削除",
  get_payment_instrument_balance: "残高を確認",
  get_payment_session: "支払いセッションを確認",
  prepare_wallet_authorization: "Wallet承認の準備",
  request_wallet_authorization: "Agentへの支払い権限を確認",
};

export const PaymentToolCall: ToolCallMessagePartComponent = ({
  toolName,
  status,
  isError,
  argsText,
  result,
}) => {
  const label = paymentToolLabels[toolName] ?? toolName;
  const failed = isError || status.type === "incomplete";
  const statusLabel =
    status.type === "running" || status.type === "requires-action"
      ? "実行中"
      : failed
        ? "失敗"
        : "完了";
  const formattedArgs = formatToolValue(argsText);
  const formattedResult = formatToolValue(result);

  return (
    <details
      className={`tool-call ${failed ? "tool-call-error" : ""}`}
      open={failed ? true : undefined}
    >
      <summary className="tool-call-summary">
        <span className="tool-call-dot" aria-hidden="true" />
        <span className="tool-call-name">{label}</span>
        <span className="tool-call-status">{statusLabel}</span>
      </summary>
      <div className="tool-call-content">
        {formattedArgs ? (
          <div>
            <span>入力</span>
            <pre>{formattedArgs}</pre>
          </div>
        ) : null}
        {formattedResult ? (
          <div>
            <span>{failed ? "エラー" : "結果"}</span>
            <pre>{formattedResult}</pre>
          </div>
        ) : null}
      </div>
    </details>
  );
};
