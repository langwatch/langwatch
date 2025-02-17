import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../server/db";
import type { CollectorRESTParams } from "../../../../server/tracer/types";
import { nanoid } from "nanoid";
import { env } from "../../../../env.mjs";

export async function GET(req: NextRequest) {
  const xAuthToken = req.headers.get("x-auth-token");
  const authHeader = req.headers.get("authorization");

  const authToken =
    xAuthToken ??
    (authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null);

  if (!authToken) {
    return NextResponse.json(
      {
        message:
          "Authentication token is required. Use X-Auth-Token header or Authorization: Bearer token.",
      },
      { status: 401 }
    );
  }

  const project = await prisma.project.findUnique({
    where: { apiKey: authToken },
    include: {
      team: true,
    },
  });

  if (!project) {
    return NextResponse.json(
      { message: "Invalid auth token." },
      { status: 401 }
    );
  }

  const traceId = `trace_${nanoid()}`;
  const params: CollectorRESTParams = {
    spans: [
      {
        trace_id: traceId,
        span_id: `span_${nanoid()}`,
        type: "span",
        input: {
          type: "text",
          value: "🐤",
        },
        output: {
          type: "text",
          value: "💯",
        },
        timestamps: {
          started_at: Date.now(),
          finished_at: Date.now(),
        },
      },
    ],
    metadata: {
      canary: true,
    },
  };

  const response = await fetch(`${env.BASE_HOST}/api/collector`, {
    method: "POST",
    headers: {
      "X-Auth-Token": authToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
  });
  if (!response.ok) {
    return NextResponse.json(
      { message: "Failed to send trace to LangWatch" },
      { status: 500 }
    );
  }

  const body = await response.json();

  // Check trace with retry mechanism
  try {
    await checkTraceWithRetry(traceId, authToken);
  } catch (error) {
    return NextResponse.json(
      { message: "Failed to get trace after multiple retries" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    status: response.status,
    body,
  });
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const checkTraceWithRetry = async (
  traceId: string,
  authToken: string
): Promise<Response> => {
  const startTime = Date.now();
  const timeoutMs = 60 * 1000; // 60 seconds timeout
  const retryIntervalMs = 5000; // 5 seconds interval

  while (Date.now() - startTime < timeoutMs) {
    await sleep(retryIntervalMs);

    const traceResponse = await fetch(`${env.BASE_HOST}/api/trace/${traceId}`, {
      headers: {
        "X-Auth-Token": authToken,
      },
    });

    if (traceResponse.ok) {
      return traceResponse;
    }
  }

  throw new Error("Timeout waiting for trace to be available");
};
