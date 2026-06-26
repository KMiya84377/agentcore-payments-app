"use client";

import { type Toolkit } from "@assistant-ui/react";
import { WalletAuthorizationTool } from "./payment-tools/wallet-authorization-tool";

export const paymentToolkit: Toolkit = {
  request_wallet_authorization: {
    type: "human",
    description:
      "Ask the signed-in user to explicitly authorize the Privy signer for an active payment wallet.",
    parameters: {
      type: "object",
      properties: {
        paymentInstrumentId: { type: "string" },
        walletAddress: { type: "string" },
        network: { type: ["string", "null"] },
      },
      required: ["paymentInstrumentId", "walletAddress"],
      additionalProperties: false,
    },
    render: WalletAuthorizationTool,
  },
};
