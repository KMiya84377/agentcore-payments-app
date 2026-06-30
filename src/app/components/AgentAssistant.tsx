"use client";

import { AgentAssistantRuntimeProvider } from "./AssistantRuntimeProvider";
import { AgentThread } from "./AgentThread";

export function AgentAssistant() {
  return (
    <AgentAssistantRuntimeProvider>
      <AgentThread />
    </AgentAssistantRuntimeProvider>
  );
}
