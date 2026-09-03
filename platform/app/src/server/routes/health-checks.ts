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
import {
  createServiceApp,
  internalSecret,
  publicEndpoint,
} from "~/server/api/security";
import { prisma } from "~/server/db";
import { sendCanary } from "~/server/health-probes/canary.service";
import { runScenarioHealthCanary } from "~/server/health-probes/scenario-canary.service";
import type { CollectorRESTParams } from "~/server/tracer/types";
import type { DeepPartial } from "~/utils/types";
import { validateInternalSecret } from "./_lib/internal-secret";

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

// ── GET /collector ───────────────────────────────────────────────────

secured
  .access(publicEndpoint("subsystem health probe"))
  .get("/collector", async (c) => {
    const auth = await authenticateProject(c);
    if ("error" in auth) {
      return c.json({ message: auth.error }, { status: auth.status });
    }
    const { authToken } = auth;

    const restParams: CollectorRESTParams = {
      spans: [
        {
          trace_id: `trace_${nanoid()}`,
          span_id: `span_${nanoid()}`,
          type: "span",
          input: { type: "text", value: "\u{1F423}" },
          output: { type: "text", value: "\u{1F4AF}" },
          timestamps: { started_at: Date.now(), finished_at: Date.now() },
        },
      ],
      metadata: { canary: true } as any,
    };

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
                  traceId: Buffer.from(
                    crypto.randomBytes(16).toString("hex"),
                    "hex",
                  ).toString("base64"),
                  spanId: Buffer.from(
                    crypto.randomBytes(8).toString("hex"),
                    "hex",
                  ).toString("base64"),
                  name: "Health check",
                  kind: "SPAN_KIND_INTERNAL" as unknown as ESpanKind,
                  startTimeUnixNano: (Date.now() * 1000 * 1000).toString(),
                  endTimeUnixNano: (Date.now() * 1000 * 1000).toString(),
                  attributes: [
                    {
                      key: "gen_ai.prompt.0.role",
                      value: { stringValue: "user" },
                    },
                    {
                      key: "gen_ai.prompt.0.content.0.text",
                      value: { stringValue: "\u{1F423}" },
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

    const [, otelCollectorResponse] = await Promise.all([
      sendCanary({
        probe: "collector",
        transport: "rest",
        url: `${env.BASE_HOST}/api/collector`,
        authToken,
        body: restParams,
      }),
      sendCanary({
        probe: "collector",
        transport: "otlp",
        url: `${env.BASE_HOST}/api/otel/v1/traces`,
        authToken,
        body: otelParams,
      }),
    ]);

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

// ── GET /processor ───────────────────────────────────────────────────

secured
  .access(publicEndpoint("subsystem health probe"))
  .get("/processor", async (c) => {
    const auth = await authenticateProject(c);
    if ("error" in auth) {
      return c.json({ message: auth.error }, { status: auth.status });
    }
    const { authToken } = auth;

    const restTraceId = `trace_${nanoid()}`;
    const restParams: CollectorRESTParams = {
      spans: [
        {
          trace_id: restTraceId,
          span_id: `span_${nanoid()}`,
          type: "span",
          input: { type: "text", value: "\u{1F424}" },
          output: { type: "text", value: "\u{1F4AF}" },
          timestamps: { started_at: Date.now(), finished_at: Date.now() },
        },
      ],
      metadata: { canary: true } as any,
    };

    const otelTraceIdBase64 = crypto.randomBytes(16).toString("base64");
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
                    {
                      key: "gen_ai.request.model",
                      value: { stringValue: "openai/gpt-4.1-nano" },
                    },
                    {
                      key: "gen_ai.prompt.0.role",
                      value: { stringValue: "user" },
                    },
                    {
                      key: "gen_ai.prompt.0.content.0.text",
                      value: { stringValue: "\u{1F424}" },
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

    const t0 = Date.now();
    logger.info(
      { restTraceId, otelTraceId: otelTraceIdBase64 },
      "Healthcheck started, sending canary traces",
    );

    const [restCollectorResponse, otelResponse] = await Promise.all([
      sendCanary({
        probe: "processor",
        transport: "rest",
        url: `${env.BASE_HOST}/api/collector`,
        authToken,
        body: restParams,
      }),
      sendCanary({
        probe: "processor",
        transport: "otlp",
        url: `${env.BASE_HOST}/api/otel/v1/traces`,
        authToken,
        body: otelParams,
      }),
    ]);

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

    const otelBody = await otelResponse.json();

    // Check traces with retry mechanism
    const checkTraceWithRetry = async (traceId: string): Promise<Response> => {
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
    };

    try {
      await Promise.all([
        checkTraceWithRetry(restTraceId).catch(() => {
          throw new Error("Failed to get REST trace after multiple retries");
        }),
        checkTraceWithRetry(otelTraceIdBase64).catch(() => {
          throw new Error("Failed to get OTLP trace after multiple retries");
        }),
      ]);
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

// ── GET /scenarios ───────────────────────────────────────────────────

// Fires a real scenario run in the dedicated canary project and reports what
// broke. Authenticated by the shared internal secret (a status-page poller has
// no user session and no project API key), checked BEFORE any run is queued.
//
//   200 { status: "ok", scenarioRunId, durationMs }        healthy
//   503 { status: "unhealthy", reason, scenarioRunId?, durationMs }
//   429 { status: "busy" }                                  already in flight
//
// @see specs/scenarios/scenario-canary-healthcheck.feature
secured
  .access(
    internalSecret(
      "scenario canary health probe — CRON_API_KEY shared secret checked " +
        "in-handler via validateInternalSecret before any run is queued",
    ),
  )
  .get("/scenarios", async (c) => {
    if (!c.req.header("authorization")) {
      return c.json(
        { message: "Authentication token is required." },
        { status: 401 },
      );
    }
    if (!validateInternalSecret(c)) {
      return c.json({ message: "Invalid auth token." }, { status: 403 });
    }

    const result = await runScenarioHealthCanary();

    if ("busy" in result) {
      return c.json({ status: "busy" }, { status: 429 });
    }
    if (result.healthy) {
      return c.json({
        status: "ok",
        scenarioRunId: result.scenarioRunId,
        durationMs: result.durationMs,
      });
    }
    return c.json(
      {
        status: "unhealthy",
        reason: result.reason,
        scenarioRunId: result.scenarioRunId,
        durationMs: result.durationMs,
      },
      { status: 503 },
    );
  });

export const app = secured.hono;
