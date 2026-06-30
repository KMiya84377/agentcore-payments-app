"use client";

import { type ToolCallMessagePartComponent } from "@assistant-ui/react";

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

const sensitiveToolField =
  /authorization|cookie|secret|token|email|user.?id|payment-signature|x-payment/i;

function redactToolValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactToolValue);

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        sensitiveToolField.test(key) ? "[redacted]" : redactToolValue(item),
      ]),
    );
  }

  return value;
}

function formatToolValue(value: unknown) {
  if (value === undefined) return null;

  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return value.length > 12000 ? `${value.slice(0, 12000)}\n...` : value;
    }
  }

  const formatted = JSON.stringify(redactToolValue(parsed), null, 2);
  return formatted.length > 12000
    ? `${formatted.slice(0, 12000)}\n...`
    : formatted;
}

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
