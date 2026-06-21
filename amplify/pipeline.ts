import { definePipeline } from "@aws-amplify/hosting/pipeline";

const repo = process.env.GITHUB_REPOSITORY_NAME;
const connectionArn = process.env.CODECONNECTIONS_CONNECTION_ARN;

if (!repo) {
  throw new Error("GITHUB_REPOSITORY_NAME must be set, for example owner/repo.");
}

if (!connectionArn) {
  throw new Error("CODECONNECTIONS_CONNECTION_ARN must be set.");
}

definePipeline({
  source: {
    repo,
    connectionArn,
    triggerOnPush: true,
  },
  synth: {
    commands: ["npm ci", "npm run agent:build", "npx cdk synth"],
    dockerEnabled: true,
  },
  branches: [
    {
      branch: process.env.PIPELINE_BRANCH ?? "main",
      stages: [
        {
          name: process.env.PIPELINE_STAGE ?? "prod",
          env: {
            account: process.env.CDK_DEFAULT_ACCOUNT ?? "682983358738",
            region:
              process.env.CDK_DEFAULT_REGION ??
              process.env.AWS_REGION ??
              "us-east-1",
          },
        },
      ],
    },
  ],
  stackName: process.env.PIPELINE_STACK_NAME ?? "agentcore-assistant-pipeline",
});
