/**
 * Hono routes for OpenTelemetry ingestion endpoints.
 *
 * Replaces:
 * - POST /api/otel/v1/traces
 * - POST /api/otel/v1/logs
 * - POST /api/otel/v1/metrics
 */
import { SpanKind, SpanStatusCode } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import { Hono } from "hono";
import { loggerMiddleware } from "~/app/api/middleware/logger";
import { tracerMiddleware } from "~/app/api/middleware/tracer";
import { getApp } from "~/server/app-layer/app";
import { prisma } from "~/server/db";
import {
  parseOtlpLogs,
  parseOtlpMetrics,
  parseOtlpTraces,
  readOtlpBody,
} from "~/server/otel/parseOtlpBody";
import { TokenResolver } from "~/server/pat/token-resolver";
import {
  enforcePatCeiling,
  extractCredentials,
  patCeilingDenialResponse,
} from "~/server/pat/auth-middleware";
import { createLogger } from "~/utils/logger/server";
import { captureException } from "~/utils/posthogErrorCapture";

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
  const credentials = extractCredentials((name) => c.req.header(name));

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

  // Enforce PAT ceiling (legacy tokens bypass). `traces:create` gates write
  // access on OTLP ingestion — same semantics as the collector path.
  try {
    await enforcePatCeiling({
      prisma,
      resolved,
      permission: "traces:create",
    });
  } catch (error) {
    const denial = patCeilingDenialResponse(error);
    return { error: denial.message, status: denial.status };
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

      const body = await readOtlpBody(c.req.raw);

      const emptyPartialSuccess = { rejectedSpans: 0, errorMessage: "" };

      if (body.byteLength === 0) {
        loggerTraces.debug("Received empty trace request, ignoring");
        return c.json({
          message: "No traces to process",
          partialSuccess: emptyPartialSuccess,
        });
      }

      const parsed = parseOtlpTraces(body, c.req.header("content-type"));
      if (!parsed.ok) {
        loggerTraces.error(
          {
            error: parsed.error,
            traceRequest: Buffer.from(body).toString("base64"),
          },
          "error parsing traces",
        );
        captureException(new Error(parsed.error), {
          extra: {
            projectId: project.id,
            traceRequest: Buffer.from(body).toString("base64"),
          },
        });
        span.setStatus({ code: SpanStatusCode.ERROR, message: "Failed to parse traces" });
        return c.json({ error: "Failed to parse traces" }, { status: 400 });
      }
      const traceRequest = parsed.request;

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

      const body = await readOtlpBody(c.req.raw);
      const parsed = parseOtlpLogs(body, c.req.header("content-type"));
      if (!parsed.ok) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: "Failed to parse logs" });
        span.recordException(new Error(parsed.error));
        loggerLogs.error(
          {
            error: parsed.error,
            logRequest: Buffer.from(body).toString("base64"),
          },
          "error parsing logs",
        );
        captureException(new Error(parsed.error), {
          extra: {
            projectId: project.id,
            logRequest: Buffer.from(body).toString("base64"),
          },
        });
        return c.json({ error: "Failed to parse logs" }, { status: 400 });
      }
      const logRequest = parsed.request;

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

      const body = await readOtlpBody(c.req.raw);
      const parsed = parseOtlpMetrics(body, c.req.header("content-type"));
      if (!parsed.ok) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: "Failed to parse metrics" });
        span.recordException(new Error(parsed.error));
        loggerMetrics.error(
          {
            error: parsed.error,
            metricsRequest: Buffer.from(body).toString("base64"),
          },
          "error parsing metrics",
        );
        captureException(new Error(parsed.error), {
          extra: {
            projectId: project.id,
            metricsRequest: Buffer.from(body).toString("base64"),
          },
        });
        return c.json({ error: "Failed to parse metrics" }, { status: 400 });
      }
      const metricsRequest = parsed.request;

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
