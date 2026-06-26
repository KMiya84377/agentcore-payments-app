"use client";

import { type ToolCallMessagePartComponent } from "@assistant-ui/react";
import {
  useLogin,
  usePrivy,
  useSigners,
  type WalletWithMetadata,
} from "@privy-io/react-auth";
import { useState } from "react";

const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
const PRIVY_SIGNER_ID = process.env.NEXT_PUBLIC_PRIVY_SIGNER_ID;

export type WalletAuthorizationArgs = {
  paymentInstrumentId: string;
  walletAddress: string;
  network?: string | null;
};

export type WalletAuthorizationResult = {
  authorized: boolean;
  reason?: "approved" | "already_authorized" | "denied";
};

function abbreviateAddress(address: string) {
  return `${address.slice(0, 8)}...${address.slice(-6)}`;
}

function WalletAuthorizationWithPrivy({
  walletAddress,
  paymentInstrumentId,
  network,
  onAuthorized,
  onDenied,
}: {
  walletAddress: string;
  paymentInstrumentId: string;
  network?: string | null;
  onAuthorized: (reason: "approved" | "already_authorized") => void;
  onDenied: () => void;
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
      onAuthorized("approved");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      if (message.toLowerCase().includes("already")) {
        setState("authorized");
        onAuthorized("already_authorized");
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
        <div className="authorization-actions">
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
          <button
            type="button"
            className="authorization-button-secondary"
            disabled={state === "authorizing"}
            onClick={onDenied}
          >
            今回は許可しない
          </button>
        </div>
      )}
    </section>
  );
}

export const WalletAuthorizationTool: ToolCallMessagePartComponent<
  WalletAuthorizationArgs,
  WalletAuthorizationResult
> = ({
  status,
  args,
  result,
  isError,
  addResult,
}) => {
  if (status.type === "running") {
    return (
      <div className="tool-call">
        <span className="tool-call-dot" aria-hidden="true" />
        <span className="tool-call-name">Walletの承認情報を確認</span>
        <span className="tool-call-status">実行中</span>
      </div>
    );
  }

  if (isError || status.type === "incomplete") {
    return (
      <div className="authorization-card authorization-card-error">
        <h3>承認を開始できません</h3>
        <p>Walletの承認処理が完了しませんでした。</p>
      </div>
    );
  }

  if (result) {
    return (
      <div className="authorization-card">
        <h3>{result.authorized ? "支払い権限を付与しました" : "承認を見送りました"}</h3>
        <p>
          {result.authorized
            ? "承認結果をAgentへ返し、処理を再開しました。"
            : "承認しなかったことをAgentへ返しました。"}
        </p>
      </div>
    );
  }

  if (!args.walletAddress || !args.paymentInstrumentId) {
    return (
      <div className="authorization-card authorization-card-error">
        <h3>承認を開始できません</h3>
        <p>Walletの承認に必要な情報を取得できませんでした。</p>
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
      walletAddress={args.walletAddress}
      paymentInstrumentId={args.paymentInstrumentId}
      network={args.network}
      onAuthorized={(reason) => addResult({ authorized: true, reason })}
      onDenied={() => addResult({ authorized: false, reason: "denied" })}
    />
  );
};
