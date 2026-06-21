import * as cdk from "aws-cdk-lib";
import * as agentcore from "aws-cdk-lib/aws-bedrockagentcore";
import type * as cognito from "aws-cdk-lib/aws-cognito";
import { Platform } from "aws-cdk-lib/aws-ecr-assets";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

const AGENTCORE_USER_SUB_HEADER =
  "X-Amzn-Bedrock-AgentCore-Runtime-Custom-User-Sub";
const AGENTCORE_USER_EMAIL_HEADER =
  "X-Amzn-Bedrock-AgentCore-Runtime-Custom-User-Email";

export type AgentCoreConstructProps = {
  userPool: cognito.IUserPool;
  userPoolClient: cognito.IUserPoolClient;
};

export class AgentCoreConstruct extends Construct {
  readonly runtime: agentcore.Runtime;
  readonly endpoint: agentcore.RuntimeEndpoint;

  constructor(scope: Construct, id: string, props: AgentCoreConstructProps) {
    super(scope, id);

    const optionalEnvironmentVariables = [
      "PAYMENT_MANAGER_ARN",
      "PAYMENT_CONNECTOR_ID",
      "PAID_WEATHER_API_URL",
    ].reduce<Record<string, string>>((accumulator, key) => {
      const value = process.env[key];

      if (value) {
        accumulator[key] = value;
      }

      return accumulator;
    }, {});

    const paymentCredentialProviderResources = process.env
      .PAYMENT_CREDENTIAL_PROVIDER_ARN
      ? [
          process.env.PAYMENT_CREDENTIAL_PROVIDER_ARN,
          process.env.PAYMENT_CREDENTIAL_PROVIDER_ARN.replace(
            ":bedrock-agentcore:",
            ":acps:",
          ),
        ]
      : ["*"];
    const paymentCredentialProviderName = process.env
      .PAYMENT_CREDENTIAL_PROVIDER_ARN
      ? process.env.PAYMENT_CREDENTIAL_PROVIDER_ARN.split(
          "/paymentcredentialprovider/",
        )[1]
      : undefined;
    const paymentCredentialSecretResources = paymentCredentialProviderName
      ? [
          cdk.Stack.of(this).formatArn({
            service: "secretsmanager",
            resource: "secret",
            resourceName: `bedrock-agentcore-identity!default/payment/stripeprivy/${paymentCredentialProviderName}-*/appsecret-*`,
            arnFormat: cdk.ArnFormat.COLON_RESOURCE_NAME,
          }),
          cdk.Stack.of(this).formatArn({
            service: "secretsmanager",
            resource: "secret",
            resourceName: `bedrock-agentcore-identity!default/payment/stripeprivy/${paymentCredentialProviderName}-*/authprivkey-*`,
            arnFormat: cdk.ArnFormat.COLON_RESOURCE_NAME,
          }),
        ]
      : [];
    const paymentTokenVaultResources = process.env
      .PAYMENT_CREDENTIAL_PROVIDER_ARN
      ? [
          process.env.PAYMENT_CREDENTIAL_PROVIDER_ARN.split(
            "/paymentcredentialprovider/",
          )[0],
        ]
      : ["*"];
    const workloadIdentityResources = [
      cdk.Stack.of(this).formatArn({
        service: "bedrock-agentcore",
        resource: "workload-identity-directory",
        resourceName: "default",
      }),
      cdk.Stack.of(this).formatArn({
        service: "bedrock-agentcore",
        resource: "workload-identity-directory",
        resourceName: "default/workload-identity/*",
      }),
    ];

    this.runtime = new agentcore.Runtime(this, "StrandsRuntime", {
      runtimeName: "StrandsAgentRuntime",
      description:
        "Strands Python AG-UI runtime deployed with Amplify backend.",
      agentRuntimeArtifact: agentcore.AgentRuntimeArtifact.fromAsset(
        "agent-runtime",
        {
          platform: Platform.LINUX_ARM64,
        },
      ),
      networkConfiguration:
        agentcore.RuntimeNetworkConfiguration.usingPublicNetwork(),
      authorizerConfiguration:
        agentcore.RuntimeAuthorizerConfiguration.usingCognito(
          props.userPool,
          [props.userPoolClient],
        ),
      protocolConfiguration: agentcore.ProtocolType.AGUI,
      environmentVariables: {
        AWS_REGION: cdk.Stack.of(this).region,
        AWS_DEFAULT_REGION: cdk.Stack.of(this).region,
        BEDROCK_MODEL_ID: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
        PAYMENTS_REGION: process.env.PAYMENTS_REGION ?? "us-east-1",
        ...optionalEnvironmentVariables,
      },
      tracingEnabled: true,
      requestHeaderConfiguration: {
        allowlistedHeaders: [
          AGENTCORE_USER_SUB_HEADER,
          AGENTCORE_USER_EMAIL_HEADER,
        ],
      },
    });

    this.runtime.role.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: [
          "bedrock:InvokeModel",
          "bedrock:InvokeModelWithResponseStream",
          "bedrock:Converse",
          "bedrock:ConverseStream",
        ],
        resources: ["*"],
      }),
    );

    this.runtime.role.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: [
          "bedrock-agentcore:ProcessPayment",
          "bedrock-agentcore:CreatePaymentInstrument",
          "bedrock-agentcore:CreatePaymentSession",
          "bedrock-agentcore:DeletePaymentInstrument",
          "bedrock-agentcore:GetPaymentInstrument",
          "bedrock-agentcore:GetPaymentInstrumentBalance",
          "bedrock-agentcore:ListPaymentInstruments",
          "bedrock-agentcore:GetPaymentSession",
          "bedrock-agentcore:ListPaymentSessions",
        ],
        resources: ["*"],
      }),
    );

    this.runtime.role.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ["bedrock-agentcore:GetResourcePaymentToken"],
        resources: [
          ...paymentCredentialProviderResources,
          ...paymentTokenVaultResources,
          ...workloadIdentityResources,
        ],
      }),
    );

    if (process.env.PAYMENT_SERVICE_ROLE_NAME) {
      const paymentsServiceRole = iam.Role.fromRoleName(
        this,
        "PaymentsServiceRole",
        process.env.PAYMENT_SERVICE_ROLE_NAME,
      );

      new iam.Policy(this, "PaymentsServiceRolePolicy", {
        roles: [paymentsServiceRole],
        statements: [
          new iam.PolicyStatement({
            actions: ["bedrock-agentcore:GetResourcePaymentToken"],
            resources: paymentCredentialProviderResources,
          }),
          new iam.PolicyStatement({
            actions: ["secretsmanager:GetSecretValue"],
            resources: paymentCredentialSecretResources,
          }),
        ],
      });
    }

    this.endpoint = new agentcore.RuntimeEndpoint(
      this,
      "StrandsRuntimeEndpoint",
      {
        endpointName: "StrandsAgentEndpoint",
        agentRuntimeId: this.runtime.agentRuntimeId,
        agentRuntimeVersion: this.runtime.agentRuntimeVersion ?? "1",
        description: "Default endpoint for the Strands AG-UI AgentCore runtime.",
      },
    );

    new cdk.CfnOutput(this, "AgentRuntimeArn", {
      value: this.runtime.agentRuntimeArn,
    });

    new cdk.CfnOutput(this, "AgentRuntimeId", {
      value: this.runtime.agentRuntimeId,
    });

    new cdk.CfnOutput(this, "AgentRuntimeEndpointArn", {
      value: this.endpoint.agentRuntimeEndpointArn,
    });

    new cdk.CfnOutput(this, "AgentRuntimeEndpointId", {
      value: this.endpoint.endpointId,
    });
  }
}
