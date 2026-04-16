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
import { TokenResolver } from "~/server/pat/token-resolver";
import { extractCredentials } from "~/server/pat/auth-middleware";
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

async function authenticateAndCheckLimit(c: {
  req: { raw: Request; header: (name: string) => string | undefined };
}) {
  const credentials = extractCredentials(c);

  if (!credentials) {
    return { error: "Authentication token is required. Use X-Auth-Token header or Authorization: Bearer token.", status: 401 as const };
  }

  const resolved = await tokenResolver.resolve({
    token: credentials.token,
    projectId: credentials.projectId,
  });

  if (!resolved) {
    return { error: "Invalid auth token.", status: 401 as const };
  }

  const project = resolved.project;

  // Check usage limits
  try {
    const limitResult = await getApp().usage.checkLimit({
      teamId: project.teamId,
    });

    if (limitResult.exceeded) {
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
            loggerTraces.error(
              { error, projectId: project.id },
              "Error sending plan limit notification",
            );
          });
      } catch (error) {
        loggerTraces.error(
          { error, projectId: project.id },
          "Error getting active plan information",
        );
      }

      return {
        error: `ERR_PLAN_LIMIT: ${limitResult.message}`,
        status: 429 as const,
      };
    }
  } catch (error) {
    loggerTraces.error(
      { error, projectId: project.id },
      "Error checking trace limit",
    );
    captureException(error as Error, {
      extra: { projectId: project.id },
    });
  }

  return { project, resolved };
}

// ── POST /traces ─────────────────────────────────────────────────────

app.post("/traces", async (c) => {
  const tracer = getLangWatchTracer("langwatch.otel.traces");

  return tracer.withActiveSpan(
    "TracesV1.handleTracesRequest",
    { kind: SpanKind.SERVER },
    async (span) => {
      const authResult = await authenticateAndCheckLimit(c);

      if ("error" in authResult) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: authResult.error });
        return c.json({ message: authResult.error }, { status: authResult.status });
      }

      const { project, resolved } = authResult;
      span.setAttribute("langwatch.project.id", project.id);

      const contentType = c.req.header("content-type");
      const body = await readBody(c.req.raw);

      const emptyPartialSuccess = { rejectedSpans: 0, errorMessage: "" };

      if (body.byteLength === 0) {
        loggerTraces.debug("Received empty trace request, ignoring");
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
              traceRequest: Buffer.from(body).toString("base64"),
            },
            "error parsing traces",
          );
          captureException(error, {
            extra: {
              projectId: project.id,
              traceRequest: Buffer.from(body).toString("base64"),
              jsonError,
            },
          });

          span.setStatus({ code: SpanStatusCode.ERROR, message: "Failed to parse traces" });
          return c.json({ error: "Failed to parse traces" }, { status: 400 });
        }
      }

      // Body successfully parsed — mark PAT as used
      if (resolved.type === "pat") {
        tokenResolver.markUsed({ patId: resolved.patId });
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
      const authResult = await authenticateAndCheckLimit(c);

      if ("error" in authResult) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: authResult.error });
        return c.json({ message: authResult.error }, { status: authResult.status });
      }

      const { project, resolved } = authResult;
      span.setAttribute("langwatch.project.id", project.id);

      const contentType = c.req.header("content-type");
      const body = await readBody(c.req.raw);
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
      if (resolved.type === "pat") {
        tokenResolver.markUsed({ patId: resolved.patId });
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
      const authResult = await authenticateAndCheckLimit(c);

      if ("error" in authResult) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: authResult.error });
        return c.json({ message: authResult.error }, { status: authResult.status });
      }

      const { project, resolved } = authResult;
      span.setAttribute("langwatch.project.id", project.id);

      const contentType = c.req.header("content-type");
      const body = await readBody(c.req.raw);
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
      if (resolved.type === "pat") {
        tokenResolver.markUsed({ patId: resolved.patId });
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
