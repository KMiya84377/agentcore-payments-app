import { defineHosting } from "@aws-amplify/hosting";
import { nextjsAdapter } from "@aws-amplify/hosting/adapters";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const hostingEnvironmentKeys = [
  "AGENTCORE_RUNTIME_ARN",
  "AGENTCORE_QUALIFIER",
  "AGENTCORE_BASE_URL",
  "X402_PAY_TO_ADDRESS",
  "X402_FACILITATOR_URL",
  "NEXT_PUBLIC_PRIVY_APP_ID",
  "NEXT_PUBLIC_PRIVY_SIGNER_ID",
];

const readLocalEnv = (projectDir: string) => {
  const envPath = join(projectDir, ".env.local");

  if (!existsSync(envPath)) {
    return {};
  }

  return Object.fromEntries(
    readFileSync(envPath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/))
      .filter((match): match is RegExpMatchArray => Boolean(match))
      .map((match) => {
        const value = match[2].trim().replace(/^['"]|['"]$/g, "");

        return [match[1], value];
      }),
  );
};

const resolveHostingEnvironment = (projectDir: string) => {
  const localEnv = readLocalEnv(projectDir);

  return Object.fromEntries(
    hostingEnvironmentKeys
      .map((key) => [key, process.env[key] ?? localEnv[key]])
      .filter((entry): entry is [string, string] => Boolean(entry[1])),
  );
};

const nextjsAdapterWithEnvironment = (projectDir: string) => {
  const manifest = nextjsAdapter({ projectDir });
  const environment = resolveHostingEnvironment(projectDir);

  for (const compute of Object.values(manifest.compute)) {
    if (compute.placement === "regional") {
      compute.environment = {
        ...compute.environment,
        ...environment,
      };
    }
  }

  return manifest;
};

defineHosting({
  framework: "nextjs",
  customAdapter: nextjsAdapterWithEnvironment,
  buildCommand: "npm run build",
  storage: {
    retainOnDelete: true,
  },
});
