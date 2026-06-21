import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { withX402, x402ResourceServer } from "@x402/next";
import { type NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const X402_BASE_SEPOLIA_NETWORK = "eip155:84532";
const X402_TEST_PRICE = "$0.001";
const X402_FACILITATOR_URL =
  process.env.X402_FACILITATOR_URL ?? "https://x402.org/facilitator";

function getPaymentHeaderDiagnostics(request: NextRequest) {
  const xPayment = request.headers.get("x-payment");
  const payment = request.headers.get("payment");
  const authorization = request.headers.get("authorization");

  return {
    hasXPaymentHeader: Boolean(xPayment),
    xPaymentHeaderLength: xPayment?.length ?? 0,
    hasPaymentHeader: Boolean(payment),
    paymentHeaderLength: payment?.length ?? 0,
    hasAuthorizationHeader: Boolean(authorization),
  };
}

async function weatherHandler(request: NextRequest) {
  console.log("[paid-weather] settled handler reached", {
    ...getPaymentHeaderDiagnostics(request),
    path: request.nextUrl.pathname,
  });

  return NextResponse.json({
    report: {
      location: "Tokyo",
      weather: "sunny",
      temperatureCelsius: 24,
      summary:
        "This is a test x402 paid weather response for AgentCore Payments validation.",
    },
    payment: {
      network: X402_BASE_SEPOLIA_NETWORK,
      price: X402_TEST_PRICE,
      settled: true,
    },
  });
}

export async function GET(request: NextRequest) {
  const payTo = process.env.X402_PAY_TO_ADDRESS;

  console.log("[paid-weather] request received", {
    ...getPaymentHeaderDiagnostics(request),
    path: request.nextUrl.pathname,
    payToConfigured: Boolean(payTo),
    facilitatorConfigured: Boolean(X402_FACILITATOR_URL),
  });

  if (!payTo) {
    return NextResponse.json(
      {
        error: "X402_PAY_TO_ADDRESS is not configured.",
      },
      { status: 500 },
    );
  }

  const facilitatorClient = new HTTPFacilitatorClient({
    url: X402_FACILITATOR_URL,
  });
  const server = new x402ResourceServer(facilitatorClient).register(
    X402_BASE_SEPOLIA_NETWORK,
    new ExactEvmScheme(),
  );

  const protectedHandler = withX402(
    weatherHandler,
    {
      accepts: {
        scheme: "exact",
        price: X402_TEST_PRICE,
        network: X402_BASE_SEPOLIA_NETWORK,
        payTo,
      },
      description: "Get test weather data for AgentCore Payments validation.",
      mimeType: "application/json",
    },
    server,
  );

  return protectedHandler(request);
}
