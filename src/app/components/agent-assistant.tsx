"use client";

import { AgentAssistantRuntimeProvider } from "./assistant-runtime-provider";
import { AgentThread } from "./agent-thread";

export function AgentAssistant() {
  return (
    <AgentAssistantRuntimeProvider>
      <AgentThread />
    </AgentAssistantRuntimeProvider>
  );
}
