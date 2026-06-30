"use client";

import {
  AssistantRuntimeProvider,
  Tools,
  useAui,
} from "@assistant-ui/react";
import { useAgUiRuntime } from "@assistant-ui/react-ag-ui";
import { HttpAgent } from "@ag-ui/client";
import { fetchAuthSession } from "aws-amplify/auth";
import { type ReactNode, useMemo } from "react";
import { paymentToolkit } from "./paymentToolkit";

const AGENTCORE_USER_SUB_HEADER =
  "X-Amzn-Bedrock-AgentCore-Runtime-Custom-User-Sub";
const AGENTCORE_USER_EMAIL_HEADER =
  "X-Amzn-Bedrock-AgentCore-Runtime-Custom-User-Email";

export function AgentAssistantRuntimeProvider({
  children,
}: {
  children: ReactNode;
}) {
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
  const runtime = useAgUiRuntime({ agent, showThinking: false });
  const aui = useAui({ tools: Tools({ toolkit: paymentToolkit }) });

  return (
    <AssistantRuntimeProvider aui={aui} runtime={runtime}>
      {children}
    </AssistantRuntimeProvider>
  );
}
