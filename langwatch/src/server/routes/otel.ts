/**
 * Hono routes for OpenTelemetry ingestion endpoints.
 *
 * Replaces:
 * - POST /api/otel/v1/traces
 * - POST /api/otel/v1/logs
 * - POST /api/otel/v1/metrics
 */
import { SpanKind, SpanStatusCode } from "@opentelemetry/api";
import type {
  IExportLogsServiceRequest,
  IExportMetricsServiceRequest,
  IExportTraceServiceRequest,
} from "@opentelemetry/otlp-transformer";
import * as root from "@opentelemetry/otlp-transformer/build/src/generated/root";
import { getLangWatchTracer } from "langwatch";
import { brotliDecompress, gunzip, inflate } from "node:zlib";
import { promisify } from "node:util";
import { Hono } from "hono";
import { loggerMiddleware } from "~/app/api/middleware/logger";
import { tracerMiddleware } from "~/app/api/middleware/tracer";
import { getApp } from "~/server/app-layer/app";
import { prisma } from "~/server/db";
import { TokenResolver } from "~/server/api-key/token-resolver";
import {
  collectAuthDiagnostics,
  enforceApiKeyCeiling,
  extractCredentials,
  apiKeyCeilingDenialResponse,
} from "~/server/api-key/auth-middleware";
import { decodeBase64OpenTelemetryId } from "~/server/tracer/utils";
import { createLogger } from "~/utils/logger/server";
import { captureException } from "~/utils/posthogErrorCapture";

const gunzipAsync = promisify(gunzip);
const inflateAsync = promisify(inflate);
const brotliDecompressAsync = promisify(brotliDecompress);

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return new Uint8Array(buf).buffer as ArrayBuffer;
}

/**
 * Reads the request body, decompressing based on Content-Encoding.
 * Supports gzip (OTEL standard), deflate, and brotli.
 */
async function readBody(req: Request): Promise<ArrayBuffer> {
  const raw = await req.arrayBuffer();
  const encoding = req.headers.get("content-encoding");

  if (!encoding || encoding === "identity") {
    return raw;
  }

  if (encoding === "gzip") {
    return toArrayBuffer(await gunzipAsync(Buffer.from(raw)));
  }

  if (encoding === "deflate") {
    return toArrayBuffer(await inflateAsync(Buffer.from(raw)));
  }

  if (encoding === "br") {
    return toArrayBuffer(await brotliDecompressAsync(Buffer.from(raw)));
  }

  throw new Error(`Unsupported Content-Encoding: ${encoding}`);
}

const traceRequestType = (root as any).opentelemetry.proto.collector.trace.v1
  .ExportTraceServiceRequest;
const logRequestType = (root as any).opentelemetry.proto.collector.logs.v1
  .ExportLogsServiceRequest;
const metricsRequestType = (root as any).opentelemetry.proto.collector.metrics
  .v1.ExportMetricsServiceRequest;

const loggerTraces = createLogger("langwatch:otel:v1:traces");
const loggerLogs = createLogger("langwatch:otel:v1:logs");
const loggerMetrics = createLogger("langwatch:otel:v1:metrics");

export const app = new Hono().basePath("/api/otel/v1");
app.use(tracerMiddleware({ name: "otel-v1" }));
app.use(loggerMiddleware());

// ── shared auth + limit check ────────────────────────────────────────

const tokenResolver = TokenResolver.create(prisma);

type RouteContext = {
  req: {
    raw: Request;
    path: string;
    method: string;
    header: (name: string) => string | undefined;
  };
};

/**
 * Classifies a token by prefix without exposing the value. Mirrors the
 * `tokenType` field emitted by the unified auth middleware so on-call can
 * filter CloudWatch by SDK shape.
 */
export function classifyTokenType(token: string): "pat" | "legacy" | "unknown" {
  if (token.startsWith("pat-lw-")) return "pat";
  if (token.startsWith("sk-lw-")) return "legacy";
  return "unknown";
}

/**
 * Resolves credentials and the active project. Logs an auth-diagnostic
 * fingerprint on every failure path so on-call can attribute a 401 to a
 * specific customer/SDK without needing the customer to reproduce. Mirrors
 * the unified-auth middleware (PR #3520) — same fields, same shape, so
 * existing CloudWatch queries work.
 */
async function authenticate(c: RouteContext, logger: ReturnType<typeof createLogger>) {
  const diag = collectAuthDiagnostics(c);
  const credentials = extractCredentials((name) => c.req.header(name));

  if (!credentials) {
    logger.warn(
      diag,
      diag.hasEmptyAuthToken
        ? "Authentication failed: X-Auth-Token sent but empty"
        : "Authentication failed: no auth header present",
    );
    return {
      error:
        "Authentication token is required. Use X-Auth-Token header or Authorization: Bearer token.",
      status: 401 as const,
    };
  }

  let resolved;
  try {
    resolved = await tokenResolver.resolve({
      token: credentials.token,
      projectId: credentials.projectId,
    });
  } catch (error) {
    logger.error(
      { ...diag, error },
      "Database error during authentication",
    );
    return { error: "Authentication service error.", status: 500 as const };
  }

  if (!resolved) {
    logger.warn(
      {
        ...diag,
        tokenType: classifyTokenType(credentials.token),
        hasProjectId: !!credentials.projectId,
      },
      "Authentication failed: invalid credentials",
    );
    return { error: "Invalid auth token.", status: 401 as const };
  }

  // Enforce PAT ceiling (legacy tokens bypass). `traces:create` gates write
  // access on OTLP ingestion — same semantics as the collector path.
  try {
    await enforceApiKeyCeiling({
      prisma,
      resolved,
      permission: "traces:create",
    });
  } catch (error) {
    const denial = apiKeyCeilingDenialResponse(error);
    logger.warn(
      {
        ...diag,
        projectId: resolved.project.id,
        tokenType: classifyTokenType(credentials.token),
        denialStatus: denial.status,
      },
      "API key permission denied for traces:create",
    );
    return { error: denial.message, status: denial.status };
  }

  return { project: resolved.project, resolved };
}

/**
 * Checks usage limits for the project and returns a 429 result if exceeded.
 * Logs `Project has reached plan limit` with `customerTraceIds` so a
 * customer-supplied trace_id can be matched to the rejection. The check
 * itself is wrapped in try/catch — on lookup failure we log and let the
 * request through (same behaviour as before).
 */
async function enforcePlanLimit(
  project: { id: string; teamId: string; team: { organizationId: string } },
  customerTraceIds: string[],
  logger: ReturnType<typeof createLogger>,
) {
  try {
    const limitResult = await getApp().usage.checkLimit({
      teamId: project.teamId,
    });

    if (!limitResult.exceeded) return null;

    try {
      const activePlan = await getApp().planProvider.getActivePlan({
        organizationId: project.team.organizationId,
      });
      getApp()
        .usageLimits.notifyPlanLimitReached({
          organizationId: project.team.organizationId,
          planName: activePlan.name ?? "free",
        })
        .catch((error: unknown) => {
          logger.error(
            { error, projectId: project.id },
            "Error sending plan limit notification",
          );
        });
    } catch (error) {
      logger.error(
        { error, projectId: project.id },
        "Error getting active plan information",
      );
    }

    logger.info(
      {
        projectId: project.id,
        currentMonthMessagesCount: limitResult.count,
        activePlanName: limitResult.planName,
        maxMessagesPerMonth: limitResult.maxMessagesPerMonth,
        customerTraceIds,
      },
      "Project has reached plan limit",
    );

    return {
      error: `ERR_PLAN_LIMIT: ${limitResult.message}`,
      status: 429 as const,
    };
  } catch (error) {
    logger.error(
      { error, projectId: project.id, customerTraceIds },
      "Error checking trace limit",
    );
    captureException(error as Error, {
      extra: { projectId: project.id },
    });
    return null;
  }
}

/**
 * Best-effort extraction of customer trace_ids from an OTLP traces body.
 * Returns up to `max` unique hex-encoded trace_ids. Never throws — if the
 * body is empty, malformed, or unparsable, returns an empty array. Used to
 * tag error logs (plan-limit, parse failure) so a customer who reports
 * "I sent trace_id X but it didn't appear" can be matched to the rejection.
 *
 * JSON-OTLP serialises trace_id as base64 strings; protobuf-OTLP decodes
 * them as Uint8Array. `decodeBase64OpenTelemetryId` handles both — output
 * is always lowercase hex, the same shape the rest of the platform uses.
 */
export function peekCustomerTraceIds(
  body: ArrayBuffer,
  contentType: string | undefined,
  max = 10,
): string[] {
  if (!body || body.byteLength === 0) return [];
  // Normalise so "application/json; charset=utf-8" is recognised. The OTLP
  // HTTP spec lets exporters append parameters and case isn't guaranteed.
  const mediaType = contentType?.split(";", 1)[0]?.trim().toLowerCase();
  let req: IExportTraceServiceRequest;
  try {
    if (mediaType === "application/json") {
      req = JSON.parse(Buffer.from(body).toString("utf-8"));
    } else {
      req = traceRequestType.decode(new Uint8Array(body));
    }
  } catch {
    return [];
  }
  const ids = new Set<string>();
  for (const rs of req.resourceSpans ?? []) {
    for (const ss of rs.scopeSpans ?? []) {
      for (const sp of ss.spans ?? []) {
        const decoded = decodeBase64OpenTelemetryId(sp.traceId);
        if (decoded) {
          ids.add(decoded);
          if (ids.size >= max) return Array.from(ids);
        }
      }
    }
  }
  return Array.from(ids);
}

// ── POST /traces ─────────────────────────────────────────────────────

app.post("/traces", async (c) => {
  const tracer = getLangWatchTracer("langwatch.otel.traces");

  return tracer.withActiveSpan(
    "TracesV1.handleTracesRequest",
    { kind: SpanKind.SERVER },
    async (span) => {
      // Auth first — 401s/permission failures should not pay body decompression
      // cost, and body content is irrelevant when we don't know who's calling.
      const authResult = await authenticate(c, loggerTraces);

      if ("error" in authResult) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: authResult.error });
        return c.json({ message: authResult.error }, { status: authResult.status });
      }

      const { project, resolved } = authResult;
      span.setAttribute("langwatch.project.id", project.id);

      const contentType = c.req.header("content-type");

      let body: ArrayBuffer;
      try {
        body = await readBody(c.req.raw);
      } catch (error) {
        loggerTraces.warn(
          {
            projectId: project.id,
            contentEncoding: c.req.header("content-encoding") ?? null,
            error: error instanceof Error ? error.message : String(error),
          },
          "OTel /traces: failed to read request body",
        );
        span.setStatus({ code: SpanStatusCode.ERROR, message: "Body read failed" });
        return c.json({ error: "Unable to read body" }, 400);
      }

      // Best-effort. If the body can't be peeked (malformed, unsupported
      // shape, etc.), customerTraceIds stays empty — the projectId is still
      // logged on every subsequent failure for correlation.
      const customerTraceIds = peekCustomerTraceIds(body, contentType);
      if (customerTraceIds.length > 0) {
        span.setAttribute(
          "langwatch.otel.customer_trace_ids",
          customerTraceIds.join(","),
        );
      }

      const limitFailure = await enforcePlanLimit(
        project,
        customerTraceIds,
        loggerTraces,
      );
      if (limitFailure) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: limitFailure.error,
        });
        return c.json(
          { message: limitFailure.error },
          { status: limitFailure.status },
        );
      }

      const emptyPartialSuccess = { rejectedSpans: 0, errorMessage: "" };

      if (body.byteLength === 0) {
        loggerTraces.debug({ projectId: project.id }, "Received empty trace request, ignoring");
        return c.json({
          message: "No traces to process",
          partialSuccess: emptyPartialSuccess,
        });
      }

      let traceRequest: IExportTraceServiceRequest;
      try {
        if (contentType === "application/json") {
          traceRequest = JSON.parse(Buffer.from(body).toString("utf-8"));
        } else {
          traceRequest = traceRequestType.decode(new Uint8Array(body));
        }
      } catch (error) {
        try {
          const json = JSON.parse(Buffer.from(body).toString("utf-8"));
          traceRequest = traceRequestType.decode(
            new Uint8Array(traceRequestType.encode(json).finish()),
          );
          if (
            !traceRequest.resourceSpans ||
            traceRequest.resourceSpans.length === 0
          ) {
            throw new Error("Spans are empty, likely an invalid format");
          }
        } catch (jsonError) {
          loggerTraces.error(
            {
              error: jsonError,
              projectId: project.id,
              customerTraceIds,
              traceRequest: Buffer.from(body).toString("base64"),
            },
            "error parsing traces",
          );
          captureException(error, {
            extra: {
              projectId: project.id,
              customerTraceIds,
              traceRequest: Buffer.from(body).toString("base64"),
              jsonError,
            },
          });

          span.setStatus({ code: SpanStatusCode.ERROR, message: "Failed to parse traces" });
          return c.json({ error: "Failed to parse traces" }, { status: 400 });
        }
      }

      // Body successfully parsed — mark PAT as used
      if (resolved.type === "apiKey") {
        tokenResolver.markUsed({ apiKeyId: resolved.apiKeyId });
      }

      const collectionResult =
        await getApp().traces.collection.handleOtlpTraceRequest(
          project.id,
          traceRequest,
          project.piiRedactionLevel,
        );

      return c.json({
        message: "Trace received successfully.",
        partialSuccess: {
          rejectedSpans: collectionResult?.rejectedSpans ?? 0,
          errorMessage: collectionResult?.errorMessage ?? "",
        },
      });
    },
  );
});

// ── POST /logs ───────────────────────────────────────────────────────

app.post("/logs", async (c) => {
  const tracer = getLangWatchTracer("langwatch.otel.logs");

  return tracer.withActiveSpan(
    "[POST] /api/otel/v1/logs",
    { kind: SpanKind.SERVER },
    async (span) => {
      const authResult = await authenticate(c, loggerLogs);

      if ("error" in authResult) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: authResult.error });
        return c.json({ message: authResult.error }, { status: authResult.status });
      }

      const { project, resolved } = authResult;
      span.setAttribute("langwatch.project.id", project.id);

      const limitFailure = await enforcePlanLimit(project, [], loggerLogs);
      if (limitFailure) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: limitFailure.error,
        });
        return c.json(
          { message: limitFailure.error },
          { status: limitFailure.status },
        );
      }

      const contentType = c.req.header("content-type");

      let body: ArrayBuffer;
      try {
        body = await readBody(c.req.raw);
      } catch (error) {
        loggerLogs.warn(
          {
            projectId: project.id,
            contentEncoding: c.req.header("content-encoding") ?? null,
            error: error instanceof Error ? error.message : String(error),
          },
          "OTel /logs: failed to read request body",
        );
        span.setStatus({ code: SpanStatusCode.ERROR, message: "Body read failed" });
        return c.json({ error: "Unable to read body" }, 400);
      }

      let logRequest: IExportLogsServiceRequest;
      try {
        if (contentType === "application/json") {
          logRequest = JSON.parse(Buffer.from(body).toString("utf-8"));
        } else {
          logRequest = logRequestType.decode(new Uint8Array(body));
        }
      } catch (error) {
        try {
          const json = JSON.parse(Buffer.from(body).toString("utf-8"));
          logRequest = logRequestType.decode(
            new Uint8Array(logRequestType.encode(json).finish()),
          );
        } catch (jsonError) {
          span.setStatus({ code: SpanStatusCode.ERROR, message: "Failed to parse logs" });
          span.recordException(
            jsonError instanceof Error ? jsonError : new Error(String(jsonError)),
          );

          loggerLogs.error(
            {
              error: jsonError,
              projectId: project.id,
              logRequest: Buffer.from(body).toString("base64"),
            },
            "error parsing logs",
          );

          captureException(error, {
            extra: {
              projectId: project.id,
              logRequest: Buffer.from(body).toString("base64"),
              jsonError,
            },
          });

          return c.json({ error: "Failed to parse logs" }, { status: 400 });
        }
      }

      // Body successfully parsed — mark PAT as used
      if (resolved.type === "apiKey") {
        tokenResolver.markUsed({ apiKeyId: resolved.apiKeyId });
      }

      await getApp().traces.logCollection.handleOtlpLogRequest({
        tenantId: project.id,
        logRequest,
        piiRedactionLevel: project.piiRedactionLevel,
      });

      return c.json({ message: "OK" });
    },
  );
});

// ── POST /metrics ────────────────────────────────────────────────────

app.post("/metrics", async (c) => {
  const tracer = getLangWatchTracer("langwatch.otel.metrics");

  return tracer.withActiveSpan(
    "[POST] /api/otel/v1/metrics",
    { kind: SpanKind.SERVER },
    async (span) => {
      const authResult = await authenticate(c, loggerMetrics);

      if ("error" in authResult) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: authResult.error });
        return c.json({ message: authResult.error }, { status: authResult.status });
      }

      const { project, resolved } = authResult;
      span.setAttribute("langwatch.project.id", project.id);

      const limitFailure = await enforcePlanLimit(project, [], loggerMetrics);
      if (limitFailure) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: limitFailure.error,
        });
        return c.json(
          { message: limitFailure.error },
          { status: limitFailure.status },
        );
      }

      const contentType = c.req.header("content-type");

      let body: ArrayBuffer;
      try {
        body = await readBody(c.req.raw);
      } catch (error) {
        loggerMetrics.warn(
          {
            projectId: project.id,
            contentEncoding: c.req.header("content-encoding") ?? null,
            error: error instanceof Error ? error.message : String(error),
          },
          "OTel /metrics: failed to read request body",
        );
        span.setStatus({ code: SpanStatusCode.ERROR, message: "Body read failed" });
        return c.json({ error: "Unable to read body" }, 400);
      }

      let metricsRequest: IExportMetricsServiceRequest;
      try {
        if (contentType === "application/json") {
          metricsRequest = JSON.parse(Buffer.from(body).toString("utf-8"));
        } else {
          metricsRequest = metricsRequestType.decode(new Uint8Array(body));
        }
      } catch (error) {
        try {
          const json = JSON.parse(Buffer.from(body).toString("utf-8"));
          metricsRequest = metricsRequestType.decode(
            new Uint8Array(metricsRequestType.encode(json).finish()),
          );
        } catch (jsonError) {
          span.setStatus({ code: SpanStatusCode.ERROR, message: "Failed to parse metrics" });
          span.recordException(
            jsonError instanceof Error ? jsonError : new Error(String(jsonError)),
          );

          loggerMetrics.error(
            {
              error: jsonError,
              projectId: project.id,
              metricsRequest: Buffer.from(body).toString("base64"),
            },
            "error parsing metrics",
          );

          captureException(error, {
            extra: {
              projectId: project.id,
              metricsRequest: Buffer.from(body).toString("base64"),
              jsonError,
            },
          });

          return c.json({ error: "Failed to parse metrics" }, { status: 400 });
        }
      }

      // Body successfully parsed — mark PAT as used
      if (resolved.type === "apiKey") {
        tokenResolver.markUsed({ apiKeyId: resolved.apiKeyId });
      }

      await getApp().traces.metricCollection.handleOtlpMetricRequest({
        tenantId: project.id,
        metricRequest: metricsRequest,
        piiRedactionLevel: project.piiRedactionLevel,
      });

      return c.json({ message: "OK" });
    },
  );
});
