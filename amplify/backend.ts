import { defineBackend } from "@aws-amplify/backend";
import { auth } from "./auth/resource.ts";
import { AgentCoreConstruct } from "./agent-core-stack.ts";

const backend = defineBackend({
  auth,
});

const agentCoreStack = backend.createStack("agent-core");

new AgentCoreConstruct(agentCoreStack, "AgentCore", {
  userPool: backend.auth.resources.userPool,
  userPoolClient: backend.auth.resources.userPoolClient,
});
