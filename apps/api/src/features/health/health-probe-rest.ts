/**
 * The five subsystem health probes: `GET
 * /api/health/{collector,evaluations,processor,triggers,workflows}`.
 * @see specs/ops/health-probe-failures.feature
 */
import { publicEndpoint } from "@langwatch/api";
import type { AppRestSecurity, MountableRestApp } from "@langwatch/api/rest";
import { createLogger } from "@langwatch/observability";
import type { ESpanKind, IExportTraceServiceRequest } from "@opentelemetry/otlp-transformer";
import crypto from "crypto";
import type { Context } from "hono";
import { nanoid } from "nanoid";
import type { CollectorRESTParams } from "@langwatch/trace-contract";

const logger = createLogger("langwatch:health-checks");

/**
 * Every key of an object tree made optional, recursively.
 */
type DeepPartial<T> = T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;

/** One project, as a probe's key resolves to it. */
export type HealthProbeProject = Readonly<{ id: string }>;

/** What the five probes reach that they do not own. */
export interface HealthProbeRestPorts {
  /**
   * Resolves a raw project API key to its project, or nothing.
   */
  resolveProjectByApiKey(token: string): Promise<HealthProbeProject | null>;
  /** The deployment's public origin, which every canary is posted back through. */
  publicBaseUrl: string;
  /** The automation application the trigger probe reads a recent fire from. */
  automation(): Readonly<{
    tryGetById(input: { triggerId: string; projectId: string }): Promise<unknown | null>;
    getRecentFires(input: {
      projectId: string;
      triggerId: string;
      limit: number;
    }): Promise<ReadonlyArray<{ createdAt: Date }>>;
  }>;
  /** Whether the project has the workflow the workflow probe was pointed at. */
  workflowExists(input: { workflowId: string; projectId: string }): Promise<boolean>;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// ── shared auth helper ───────────────────────────────────────────────

async function authenticateProject(
  c: Pick<Context, "req">,
  ports: HealthProbeRestPorts,
): Promise<{ error: string; status: 401 } | { project: HealthProbeProject; authToken: string }> {
  const xAuthToken = c.req.header("x-auth-token");
  const authHeader = c.req.header("authorization");
  const authToken = xAuthToken ?? (authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null);

  if (!authToken) {
    return {
      error:
        "Authentication token is required. Use X-Auth-Token header or Authorization: Bearer token.",
      status: 401 as const,
    };
  }

  const project = await ports.resolveProjectByApiKey(authToken);

  if (!project) {
    return { error: "Invalid auth token.", status: 401 as const };
  }

  return { project, authToken };
}

// ── GET /collector ───────────────────────────────────────────────────

async function collectorProbe(c: Context, ports: HealthProbeRestPorts): Promise<Response> {
  const auth = await authenticateProject(c, ports);
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
                traceId: Buffer.from(crypto.randomBytes(16).toString("hex"), "hex").toString(
                  "base64",
                ),
                spanId: Buffer.from(crypto.randomBytes(8).toString("hex"), "hex").toString(
                  "base64",
                ),
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

  const [restCollectorResponse, otelCollectorResponse] = await Promise.all([
    fetch(`${ports.publicBaseUrl}/api/collector`, {
      method: "POST",
      headers: {
        "X-Auth-Token": authToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(restParams),
    }),
    fetch(`${ports.publicBaseUrl}/api/otel/v1/traces`, {
      method: "POST",
      headers: {
        "X-Auth-Token": authToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(otelParams),
    }),
  ]);

  if (!restCollectorResponse.ok) {
    return c.json({ message: "Failed to send trace to LangWatch using REST" }, { status: 500 });
  }

  if (!otelCollectorResponse.ok) {
    return c.json({ message: "Failed to send trace to LangWatch using OTLP" }, { status: 500 });
  }

  const otelBody = await otelCollectorResponse.json();
  return c.json({
    status: otelCollectorResponse.status,
    body: otelBody,
  });
}

// ── GET /evaluations ─────────────────────────────────────────────────

async function evaluationsProbe(c: Context, ports: HealthProbeRestPorts): Promise<Response> {
  const auth = await authenticateProject(c, ports);
  if ("error" in auth) {
    return c.json({ message: auth.error }, { status: auth.status });
  }
  const { authToken } = auth;

  let response: Response | null = null;
  let attempts = 0;
  const maxAttempts = 3;
  while (attempts < maxAttempts) {
    response = await fetch(
      `${ports.publicBaseUrl}/api/evaluations/presidio/pii_detection/evaluate`,
      {
        method: "POST",
        headers: {
          "X-Auth-Token": authToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          data: {
            input: "Hello, my name is John Canary and my email is canary@langwatch.ai.",
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
}

// ── GET /processor ───────────────────────────────────────────────────

async function processorProbe(c: Context, ports: HealthProbeRestPorts): Promise<Response> {
  const auth = await authenticateProject(c, ports);
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
                spanId: Buffer.from(crypto.randomBytes(8).toString("hex"), "hex").toString(
                  "base64",
                ),
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
    fetch(`${ports.publicBaseUrl}/api/collector`, {
      method: "POST",
      headers: {
        "X-Auth-Token": authToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(restParams),
    }),
    fetch(`${ports.publicBaseUrl}/api/otel/v1/traces`, {
      method: "POST",
      headers: {
        "X-Auth-Token": authToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(otelParams),
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

  if (!restCollectorResponse.ok) {
    return c.json({ message: "Failed to send trace to LangWatch using REST" }, { status: 500 });
  }

  if (!otelResponse.ok) {
    return c.json({ message: "Failed to send trace to LangWatch using OTLP" }, { status: 500 });
  }

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
          `${ports.publicBaseUrl}/api/traces/${encodeURIComponent(traceId)}`,
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
  logger.info({ restTraceId, otelTraceId: otelTraceIdBase64, totalMs }, "Healthcheck passed");

  return c.json({
    status: otelResponse.status,
    body: otelBody,
  });
}

// ── GET /triggers ────────────────────────────────────────────────────

async function triggersProbe(c: Context, ports: HealthProbeRestPorts): Promise<Response> {
  const auth = await authenticateProject(c, ports);
  if ("error" in auth) {
    return c.json({ message: auth.error }, { status: auth.status });
  }
  const { project } = auth;

  const triggerId = c.req.query("triggerId") ?? "";

  const trigger = await ports.automation().tryGetById({
    triggerId,
    projectId: project.id,
  });

  if (!trigger) {
    return c.json({ message: "Trigger not found." }, { status: 404 });
  }

  const [lastTriggerSent] = await ports.automation().getRecentFires({
    projectId: project.id,
    triggerId,
    limit: 1,
  });

  if (!lastTriggerSent) {
    return c.json({ message: "No trigger sent found." }, { status: 404 });
  }

  const oneHourAgo = new Date(Date.now() - 1 * 60 * 60 * 1000);
  if (lastTriggerSent.createdAt < oneHourAgo) {
    return c.json({ message: "Trigger not triggered within the last hour." }, { status: 404 });
  }

  return c.json({
    status: 200,
    body: {
      message: "Trigger triggered within the last hour.",
    },
  });
}

// ── GET /workflows ───────────────────────────────────────────────────

async function workflowsProbe(c: Context, ports: HealthProbeRestPorts): Promise<Response> {
  const auth = await authenticateProject(c, ports);
  if ("error" in auth) {
    return c.json({ message: auth.error }, { status: auth.status });
  }
  const { project, authToken } = auth;

  const workflowId = c.req.query("workflowId") ?? "";

  if (!(await ports.workflowExists({ workflowId, projectId: project.id }))) {
    return c.json({ message: "Workflow not found." }, { status: 404 });
  }

  let response: Response | null = null;
  let attempts = 0;
  const maxAttempts = 3;
  while (attempts < maxAttempts) {
    response = await fetch(`${ports.publicBaseUrl}/api/workflows/${workflowId}/run`, {
      method: "POST",
      headers: {
        "X-Auth-Token": authToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ input: "\u{1F425}" }),
    });
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
}

/** `/api/health/*`, bound to one process. */
export function createHealthProbeRestApp(options: {
  security: AppRestSecurity;
  ports: HealthProbeRestPorts;
}): MountableRestApp {
  const { security, ports } = options;
  // No `/api/v1` twin: the probes are the deployment's own surface, not the
  // published product API, and an orchestrator's probe URL is configuration.
  const secured = security.createServiceApp({ basePath: "/api/health", v1Alias: false });
  const probe = publicEndpoint("subsystem health probe");

  secured.access(probe).get("/collector", (c) => collectorProbe(c, ports));
  secured.access(probe).get("/evaluations", (c) => evaluationsProbe(c, ports));
  secured.access(probe).get("/processor", (c) => processorProbe(c, ports));
  secured.access(probe).get("/triggers", (c) => triggersProbe(c, ports));
  secured.access(probe).get("/workflows", (c) => workflowsProbe(c, ports));

  return secured.hono;
}
