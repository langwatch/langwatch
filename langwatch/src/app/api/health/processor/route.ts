import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../server/db";
import { env } from "../../../../env.mjs";
import type { ESpanKind } from "@opentelemetry/otlp-transformer";
import type { IExportTraceServiceRequest } from "@opentelemetry/otlp-transformer";
import type { DeepPartial } from "../../../../utils/types";
import type { CollectorRESTParams } from "../../../../server/tracer/types";
import { nanoid } from "nanoid";
import crypto from "crypto";

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

  const restTraceId = `trace_${nanoid()}`;
  const restParams: CollectorRESTParams = {
    spans: [
      {
        trace_id: restTraceId,
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

  const otelTraceId = crypto.randomBytes(16).toString("hex");
  const otelParams: DeepPartial<IExportTraceServiceRequest> = {
    resourceSpans: [
      {
        resource: {
          attributes: [
            {
              key: "canary",
              value: {
                stringValue: "true",
              },
            },
          ],
        },
        scopeSpans: [
          {
            scope: {
              name: "opentelemetry.langwatch.health_check",
            },
            spans: [
              {
                traceId: Buffer.from(otelTraceId, "hex").toString("base64"),
                spanId: Buffer.from(
                  crypto.randomBytes(8).toString("hex"),
                  "hex"
                ).toString("base64"),
                name: "Health check",
                kind: "SPAN_KIND_INTERNAL" as unknown as ESpanKind,
                startTimeUnixNano: (Date.now() * 1000 * 1000).toString(),
                endTimeUnixNano: (Date.now() * 1000 * 1000).toString(),
                attributes: [
                  {
                    key: "gen_ai.request.model",
                    value: {
                      stringValue: "openai/gpt-4.1-nano",
                    },
                  },
                  {
                    key: "gen_ai.prompt.0.role",
                    value: {
                      stringValue: "user",
                    },
                  },
                  {
                    key: "gen_ai.prompt.0.content.0.text",
                    value: {
                      stringValue: "🐤",
                    },
                  },
                  {
                    key: "gen_ai.completion.0.text",
                    value: {
                      stringValue: "💯",
                    },
                  },
                ],
                status: {},
              },
            ],
          },
        ],
      },
    ],
  };

  const [restCollectorResponse, otelResponse] = await Promise.all([
    fetch(`${env.BASE_HOST}/api/collector`, {
      method: "POST",
      headers: {
        "X-Auth-Token": authToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(restParams),
    }),
    fetch(`${env.BASE_HOST}/api/otel/v1/traces`, {
      method: "POST",
      headers: {
        "X-Auth-Token": authToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(otelParams),
    }),
  ]);

  if (!restCollectorResponse.ok) {
    return NextResponse.json(
      { message: "Failed to send trace to LangWatch using REST" },
      { status: 500 }
    );
  }

  if (!otelResponse.ok) {
    return NextResponse.json(
      { message: "Failed to send trace to LangWatch using OTLP" },
      { status: 500 }
    );
  }

  const otelBody = await otelResponse.json();

  // Check traces with retry mechanism
  try {
    await Promise.all([
      checkTraceWithRetry(restTraceId, authToken).catch((error) => {
        throw new Error("Failed to get REST trace after multiple retries");
      }),
      checkTraceWithRetry(otelTraceId, authToken).catch((error) => {
        throw new Error("Failed to get OTLP trace after multiple retries");
      }),
    ]);
  } catch (error) {
    return NextResponse.json(
      { message: (error as Error).message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    status: otelResponse.status,
    body: otelBody,
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
