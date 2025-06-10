import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../server/db";
import type { CollectorRESTParams } from "../../../../server/tracer/types";
import { nanoid } from "nanoid";
import { env } from "../../../../env.mjs";
import type {
  ESpanKind,
  IExportTraceServiceRequest,
} from "@opentelemetry/otlp-transformer";
import type { DeepPartial } from "../../../../utils/types";
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

  const restParams: CollectorRESTParams = {
    spans: [
      {
        trace_id: `trace_${nanoid()}`,
        span_id: `span_${nanoid()}`,
        type: "span",
        input: {
          type: "text",
          value: "🐣",
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
                traceId: Buffer.from(
                  crypto.randomBytes(16).toString("hex"),
                  "hex"
                ).toString("base64"),
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
                    key: "gen_ai.prompt.0.role",
                    value: {
                      stringValue: "user",
                    },
                  },
                  {
                    key: "gen_ai.prompt.0.content.0.text",
                    value: {
                      stringValue: "🐣",
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

  const [restCollectorResponse, otelCollectorResponse] = await Promise.all([
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

  if (!otelCollectorResponse.ok) {
    return NextResponse.json(
      { message: "Failed to send trace to LangWatch using OTLP" },
      { status: 500 }
    );
  }

  const otelBody = await otelCollectorResponse.json();
  return NextResponse.json({
    status: otelCollectorResponse.status,
    body: otelBody,
  });
}
