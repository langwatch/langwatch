/**
 * Hono routes for health-check sub-endpoints.
 *
 * Replaces:
 * - GET /api/health/collector   (sends canary traces via REST + OTLP)
 * - GET /api/health/evaluations (runs a sample PII evaluation)
 * - GET /api/health/processor   (sends canary traces + polls until processed)
 * - GET /api/health/triggers    (checks a trigger fired within the last hour)
 * - GET /api/health/workflows   (runs a sample workflow)
 *
 * NOTE: The simple GET /api/health (204) is already handled in health.ts.
 */

import { createLogger } from "@langwatch/observability";
import type {
  ESpanKind,
  IExportTraceServiceRequest,
} from "@opentelemetry/otlp-transformer";
import crypto from "crypto";
import { nanoid } from "nanoid";
import { env } from "~/env.mjs";
import { createServiceApp, publicEndpoint } from "~/server/api/security";
import { prisma } from "~/server/db";
import type { CollectorRESTParams } from "~/server/tracer/types";
import type { DeepPartial } from "~/utils/types";

const logger = createLogger("langwatch:health-checks");

const secured = createServiceApp({ basePath: "/api/health" });

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// ── shared auth helper ───────────────────────────────────────────────

async function authenticateProject(c: {
  req: { header: (name: string) => string | undefined };
}) {
  const xAuthToken = c.req.header("x-auth-token");
  const authHeader = c.req.header("authorization");
  const authToken =
    xAuthToken ??
    (authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null);

  if (!authToken) {
    return {
      error:
        "Authentication token is required. Use X-Auth-Token header or Authorization: Bearer token.",
      status: 401 as const,
    };
  }

  const project = await prisma.project.findUnique({
    where: { apiKey: authToken },
    include: { team: true },
  });

  if (!project) {
    return { error: "Invalid auth token.", status: 401 as const };
  }

  return { project, authToken };
}

// ── shared canary-trace helpers (collector + processor) ────────────────

/** Builds the REST + OTLP canary trace payloads sent to the collector
 *  endpoints. `includeModelAttribute` matches the processor check's extra
 *  `gen_ai.request.model` attribute (the collector check omits it). */
function buildCanaryTracePayloads({
  emoji,
  includeModelAttribute,
}: {
  emoji: string;
  includeModelAttribute: boolean;
}): {
  restTraceId: string;
  otelTraceIdBase64: string;
  restParams: CollectorRESTParams;
  otelParams: DeepPartial<IExportTraceServiceRequest>;
} {
  const restTraceId = `trace_${nanoid()}`;
  const otelTraceIdBase64 = crypto.randomBytes(16).toString("base64");

  const restParams: CollectorRESTParams = {
    spans: [
      {
        trace_id: restTraceId,
        span_id: `span_${nanoid()}`,
        type: "span",
        input: { type: "text", value: emoji },
        output: { type: "text", value: "\u{1F4AF}" },
        timestamps: { started_at: Date.now(), finished_at: Date.now() },
      },
    ],
    metadata: { canary: true } as any,
  };

  const modelAttribute = includeModelAttribute
    ? [
        {
          key: "gen_ai.request.model",
          value: { stringValue: "openai/gpt-4.1-nano" },
        },
      ]
    : [];

  const otelParams: DeepPartial<IExportTraceServiceRequest> = {
    resourceSpans: [
      {
        resource: {
          attributes: [
            {
              key: "metadata.canary",
              value: { stringValue: "true" },
            },
          ],
        },
        scopeSpans: [
          {
            scope: { name: "opentelemetry.langwatch.health_check" },
            spans: [
              {
                traceId: otelTraceIdBase64,
                spanId: Buffer.from(
                  crypto.randomBytes(8).toString("hex"),
                  "hex",
                ).toString("base64"),
                name: "Health check",
                kind: "SPAN_KIND_INTERNAL" as unknown as ESpanKind,
                startTimeUnixNano: (Date.now() * 1000 * 1000).toString(),
                endTimeUnixNano: (Date.now() * 1000 * 1000).toString(),
                attributes: [
                  ...modelAttribute,
                  {
                    key: "gen_ai.prompt.0.role",
                    value: { stringValue: "user" },
                  },
                  {
                    key: "gen_ai.prompt.0.content.0.text",
                    value: { stringValue: emoji },
                  },
                  {
                    key: "gen_ai.completion.0.text",
                    value: { stringValue: "\u{1F4AF}" },
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

  return { restTraceId, otelTraceIdBase64, restParams, otelParams };
}

/** Sends the REST + OTLP canary traces in parallel, returning both raw
 *  responses for the caller to validate. */
async function sendCanaryTraces({
  authToken,
  restParams,
  otelParams,
}: {
  authToken: string;
  restParams: CollectorRESTParams;
  otelParams: DeepPartial<IExportTraceServiceRequest>;
}): Promise<{ restResponse: Response; otelResponse: Response }> {
  const [restResponse, otelResponse] = await Promise.all([
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
  return { restResponse, otelResponse };
}

/** The wire failure response for a canary send, or null when both succeeded. */
function canarySendFailureResponse(
  c: any,
  {
    restResponse,
    otelResponse,
  }: { restResponse: Response; otelResponse: Response },
): Response | null {
  if (!restResponse.ok) {
    return c.json(
      { message: "Failed to send trace to LangWatch using REST" },
      { status: 500 },
    );
  }
  if (!otelResponse.ok) {
    return c.json(
      { message: "Failed to send trace to LangWatch using OTLP" },
      { status: 500 },
    );
  }
  return null;
}

// ── GET /collector ───────────────────────────────────────────────────

secured
  .access(publicEndpoint("subsystem health probe"))
  .get("/collector", async (c) => {
    const auth = await authenticateProject(c);
    if ("error" in auth) {
      return c.json({ message: auth.error }, { status: auth.status });
    }
    const { authToken } = auth;

    const { restParams, otelParams } = buildCanaryTracePayloads({
      emoji: "\u{1F423}",
      includeModelAttribute: false,
    });

    const {
      restResponse: restCollectorResponse,
      otelResponse: otelCollectorResponse,
    } = await sendCanaryTraces({ authToken, restParams, otelParams });

    const failure = canarySendFailureResponse(c, {
      restResponse: restCollectorResponse,
      otelResponse: otelCollectorResponse,
    });
    if (failure) return failure;

    const otelBody = await otelCollectorResponse.json();
    return c.json({
      status: otelCollectorResponse.status,
      body: otelBody,
    });
  });

// ── GET /evaluations ─────────────────────────────────────────────────

secured
  .access(publicEndpoint("subsystem health probe"))
  .get("/evaluations", async (c) => {
    const auth = await authenticateProject(c);
    if ("error" in auth) {
      return c.json({ message: auth.error }, { status: auth.status });
    }
    const { authToken } = auth;

    let response: Response | null = null;
    let attempts = 0;
    const maxAttempts = 3;
    while (attempts < maxAttempts) {
      response = await fetch(
        `${env.BASE_HOST}/api/evaluations/presidio/pii_detection/evaluate`,
        {
          method: "POST",
          headers: {
            "X-Auth-Token": authToken,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            data: {
              input:
                "Hello, my name is John Canary and my email is canary@langwatch.ai.",
            },
            settings: {
              entities: {
                email_address: true,
                person: true,
              },
            },
          }),
        },
      );
      if (response.ok) {
        break;
      } else if (attempts < maxAttempts - 1) {
        await sleep(1000);
        attempts++;
      } else {
        return c.json(
          {
            message: `Failed to run sample evaluation: ${await response.text()}`,
          },
          { status: 500 },
        );
      }
    }

    return c.json({
      status: response?.status,
      body: await response?.json(),
    });
  });

// ── /processor retry-poll helpers ───────────────────────────────────────

/** Polls `/api/traces/:id` until it 200s or the 60s timeout elapses,
 *  logging slow responses and fetch errors along the way. Throws once
 *  exhausted. */
async function pollForCanaryTrace({
  authToken,
  traceId,
}: {
  authToken: string;
  traceId: string;
}): Promise<Response> {
  const startTime = Date.now();
  const timeoutMs = 60 * 1000;
  const retryIntervalMs = 2000;
  let attempt = 0;

  while (Date.now() - startTime < timeoutMs) {
    await sleep(retryIntervalMs);
    attempt++;

    try {
      const fetchStart = Date.now();
      const traceResponse = await fetch(
        `${env.BASE_HOST}/api/traces/${encodeURIComponent(traceId)}`,
        {
          headers: { "X-Auth-Token": authToken },
        },
      );
      const fetchMs = Date.now() - fetchStart;

      if (traceResponse.ok) {
        logger.info(
          { traceId, attempt, fetchMs, elapsedMs: Date.now() - startTime },
          "Trace found",
        );
        return traceResponse;
      }

      if (fetchMs > 3000) {
        logger.warn(
          {
            traceId,
            attempt,
            fetchMs,
            status: traceResponse.status,
            elapsedMs: Date.now() - startTime,
          },
          "Trace poll slow response",
        );
      }
    } catch (error) {
      logger.warn(
        {
          traceId,
          attempt,
          elapsedMs: Date.now() - startTime,
          error: error instanceof Error ? error.message : String(error),
        },
        "Trace poll fetch error",
      );
    }
  }

  logger.warn(
    { traceId, attempts: attempt, elapsedMs: Date.now() - startTime },
    "Trace poll exhausted all attempts",
  );
  throw new Error("Timeout waiting for trace to be available");
}

/** Waits for both canary traces to become queryable, naming which side
 *  (REST/OTLP) failed if either polling exhausts its retries. */
async function awaitCanaryTraces({
  authToken,
  restTraceId,
  otelTraceIdBase64,
}: {
  authToken: string;
  restTraceId: string;
  otelTraceIdBase64: string;
}): Promise<void> {
  await Promise.all([
    pollForCanaryTrace({ authToken, traceId: restTraceId }).catch(() => {
      throw new Error("Failed to get REST trace after multiple retries");
    }),
    pollForCanaryTrace({ authToken, traceId: otelTraceIdBase64 }).catch(() => {
      throw new Error("Failed to get OTLP trace after multiple retries");
    }),
  ]);
}

// ── GET /processor ───────────────────────────────────────────────────

secured
  .access(publicEndpoint("subsystem health probe"))
  .get("/processor", async (c) => {
    const auth = await authenticateProject(c);
    if ("error" in auth) {
      return c.json({ message: auth.error }, { status: auth.status });
    }
    const { authToken } = auth;

    const { restTraceId, otelTraceIdBase64, restParams, otelParams } =
      buildCanaryTracePayloads({
        emoji: "\u{1F424}",
        includeModelAttribute: true,
      });

    const t0 = Date.now();
    logger.info(
      { restTraceId, otelTraceId: otelTraceIdBase64 },
      "Healthcheck started, sending canary traces",
    );

    const { restResponse: restCollectorResponse, otelResponse } =
      await sendCanaryTraces({ authToken, restParams, otelParams });

    const sendDurationMs = Date.now() - t0;
    logger.info(
      {
        restTraceId,
        otelTraceId: otelTraceIdBase64,
        sendDurationMs,
        restStatus: restCollectorResponse.status,
        otelStatus: otelResponse.status,
      },
      "Canary traces sent",
    );

    const failure = canarySendFailureResponse(c, {
      restResponse: restCollectorResponse,
      otelResponse,
    });
    if (failure) return failure;

    const otelBody = await otelResponse.json();

    try {
      await awaitCanaryTraces({ authToken, restTraceId, otelTraceIdBase64 });
    } catch (error) {
      const totalMs = Date.now() - t0;
      logger.warn(
        { restTraceId, otelTraceId: otelTraceIdBase64, totalMs },
        `Healthcheck failed: ${(error as Error).message}`,
      );
      return c.json({ message: (error as Error).message }, { status: 500 });
    }

    const totalMs = Date.now() - t0;
    logger.info(
      { restTraceId, otelTraceId: otelTraceIdBase64, totalMs },
      "Healthcheck passed",
    );

    return c.json({
      status: otelResponse.status,
      body: otelBody,
    });
  });

// ── GET /triggers ────────────────────────────────────────────────────

secured
  .access(publicEndpoint("subsystem health probe"))
  .get("/triggers", async (c) => {
    const auth = await authenticateProject(c);
    if ("error" in auth) {
      return c.json({ message: auth.error }, { status: auth.status });
    }
    const { project } = auth;

    const triggerId = c.req.query("triggerId") ?? "";

    const trigger = await prisma.trigger.findUnique({
      where: { id: triggerId, projectId: project.id },
    });

    if (!trigger) {
      return c.json({ message: "Trigger not found." }, { status: 404 });
    }

    const lastTriggerSent = await prisma.triggerSent.findFirst({
      where: { triggerId, projectId: project.id },
      orderBy: { createdAt: "desc" },
    });

    if (!lastTriggerSent) {
      return c.json({ message: "No trigger sent found." }, { status: 404 });
    }

    const oneHourAgo = new Date(Date.now() - 1 * 60 * 60 * 1000);
    if (lastTriggerSent.createdAt < oneHourAgo) {
      return c.json(
        { message: "Trigger not triggered within the last hour." },
        { status: 404 },
      );
    }

    return c.json({
      status: 200,
      body: {
        message: "Trigger triggered within the last hour.",
      },
    });
  });

// ── GET /workflows ───────────────────────────────────────────────────

secured
  .access(publicEndpoint("subsystem health probe"))
  .get("/workflows", async (c) => {
    const auth = await authenticateProject(c);
    if ("error" in auth) {
      return c.json({ message: auth.error }, { status: auth.status });
    }
    const { project, authToken } = auth;

    const workflowId = c.req.query("workflowId") ?? "";

    const workflow = await prisma.workflow.findUnique({
      where: { id: workflowId, projectId: project.id },
    });

    if (!workflow) {
      return c.json({ message: "Workflow not found." }, { status: 404 });
    }

    let response: Response | null = null;
    let attempts = 0;
    const maxAttempts = 3;
    while (attempts < maxAttempts) {
      response = await fetch(
        `${env.BASE_HOST}/api/workflows/${workflow.id}/run`,
        {
          method: "POST",
          headers: {
            "X-Auth-Token": authToken,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ input: "\u{1F425}" }),
        },
      );
      if (response.ok) {
        break;
      } else if (attempts < maxAttempts - 1) {
        await sleep(1000);
        attempts++;
      } else {
        return c.json(
          {
            message: `Failed to run sample workflow: ${await response.text()}`,
          },
          { status: 500 },
        );
      }
    }

    return c.json({
      status: response?.status,
      body: await response?.json(),
    });
  });

export const app = secured.hono;
