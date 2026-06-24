export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const agentRuntimeArn = process.env.AGENTCORE_RUNTIME_ARN;
const qualifier = process.env.AGENTCORE_QUALIFIER ?? "StrandsAgentEndpoint";
const region = process.env.AWS_REGION ?? "us-east-1";
const agentCoreBaseUrl =
  process.env.AGENTCORE_BASE_URL ??
  `https://bedrock-agentcore.${region}.amazonaws.com`;
const AGENTCORE_USER_SUB_HEADER =
  "X-Amzn-Bedrock-AgentCore-Runtime-Custom-User-Sub";
const AGENTCORE_USER_EMAIL_HEADER =
  "X-Amzn-Bedrock-AgentCore-Runtime-Custom-User-Email";

function toSse(event: Record<string, unknown>) {
  return `data: ${JSON.stringify(event)}\n\n`;
}

function errorResponse(status: number, message: string, code: string) {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode(
          toSse({
            type: "RUN_ERROR",
            message,
            code,
          }),
        ),
      );
      controller.close();
    },
  });

  return new Response(stream, {
    status,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}

export async function POST(request: Request) {
  
  if (!agentRuntimeArn) {
    return errorResponse(
      500,
      "AGENTCORE_RUNTIME_ARN is not configured.",
      "CONFIGURATION_ERROR",
    );
  }

  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return errorResponse(
      401,
      "Authorization bearer token is required.",
      "AUTHORIZATION_REQUIRED",
    );
  }

  const userSub = request.headers.get(AGENTCORE_USER_SUB_HEADER);
  if (!userSub) {
    return errorResponse(
      401,
      "User sub header is required.",
      "USER_SUB_REQUIRED",
    );
  }

  const userEmail = request.headers.get(AGENTCORE_USER_EMAIL_HEADER);
  if (!userEmail) {
    return errorResponse(
      401,
      "User email header is required.",
      "USER_EMAIL_REQUIRED",
    );
  }

  try {
    const body = await request.json();
    const agentUrl = `${agentCoreBaseUrl}/runtimes/${encodeURIComponent(
      agentRuntimeArn,
    )}/invocations?qualifier=${encodeURIComponent(qualifier)}`;

    const headers = new Headers({
      Accept: "text/event-stream",
      Authorization: authorization,
      "Content-Type": "application/json",
    });

    headers.set(AGENTCORE_USER_SUB_HEADER, userSub);
    headers.set(AGENTCORE_USER_EMAIL_HEADER, userEmail);

    const response = await fetch(agentUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const message = await response.text();

      return errorResponse(
        response.status,
        message || `Agent request failed with status ${response.status}.`,
        "AGENT_REQUEST_FAILED",
      );
    }

    if (!response.body) {
      return errorResponse(
        502,
        "Agent returned an empty response.",
        "EMPTY_AGENT_RESPONSE",
      );
    }

    return new Response(response.body, {
      status: response.status,
      headers: {
        "Content-Type":
          response.headers.get("content-type") ??
          "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    return errorResponse(
      502,
      error instanceof Error ? error.message : "Agent request failed.",
      "AGENT_REQUEST_FAILED",
    );
  }
}
