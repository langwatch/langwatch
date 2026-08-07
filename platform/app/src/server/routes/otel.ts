/**
 * Hono routes for OpenTelemetry ingestion endpoints.
 *
 * Replaces:
 * - POST /api/otel/v1/traces
 * - POST /api/otel/v1/logs
 * - POST /api/otel/v1/metrics
 */

import { resolveSourceNonBillable } from "@ee/governance/services/costAttributionPolicy.service";
import {
  enforceApiKeyIdOnLogRequest,
  enforceApiKeyIdOnMetricRequest,
  enforceApiKeyIdOnTraceRequest,
  stampIngestKeyProvenanceOnLogRequest,
  stampIngestKeyProvenanceOnMetricRequest,
  stampIngestKeyProvenanceOnTraceRequest,
} from "@ee/governance/services/ingestKeyProvenance.utils";
import { createLogger } from "@langwatch/observability";
import { SpanKind, SpanStatusCode } from "@opentelemetry/api";
import type { IExportTraceServiceRequest } from "@opentelemetry/otlp-transformer";
import * as root from "@opentelemetry/otlp-transformer/build/src/generated/root";
import { getLangWatchTracer } from "langwatch";
import { createServiceApp, handlerManagedAuth } from "~/server/api/security";
import {
  apiKeyCeilingDenialResponse,
  collectAuthDiagnostics,
  enforceApiKeyCeiling,
  extractCredentials,
} from "~/server/api-key/auth-middleware";
import { TokenResolver } from "~/server/api-key/token-resolver";
import { getApp } from "~/server/app-layer/app";
import { PlanLimitExceededError } from "~/server/app-layer/usage/errors";
import type { UsageLimitResult } from "~/server/app-layer/usage/usage.service";
import { prisma } from "~/server/db";
import { DEFAULT_PII_REDACTION_LEVEL } from "~/server/event-sourcing/pipelines/trace-processing/schemas/commands";
import {
  OTLP_MAX_BODY_BYTES,
  parseOtlpLogs,
  parseOtlpMetrics,
  parseOtlpTraces,
  readOtlpBody,
} from "~/server/otel/parseOtlpBody";
import { decodeBase64OpenTelemetryId } from "~/server/tracer/utils";
import { captureException } from "~/utils/posthogErrorCapture";
import { bodyLimit } from "./_lib/body-limit";

const traceRequestType = (root as any).opentelemetry.proto.collector.trace.v1
  .ExportTraceServiceRequest;

const loggerTraces = createLogger("langwatch:otel:v1:traces");
const loggerLogs = createLogger("langwatch:otel:v1:logs");
const loggerMetrics = createLogger("langwatch:otel:v1:metrics");

/**
 * A rejected OTLP body is unparsed, so it has not been through PII redaction.
 * Only its length may be recorded: the bytes themselves carry prompts,
 * completions and host identifiers, and neither the log sink nor PostHog is a
 * place customer content is allowed to reach.
 */
function bodyForensics(body: ArrayBuffer | Uint8Array) {
  return { bodyBytes: body.byteLength };
}

const AUTH_REASON = "OTLP ingestion API key resolved in-handler";

// One policy for all three OTLP signals: traces, logs and metrics are the same
// write to the same tenant, so they answer to the same permission.
const otelIngestAuth = handlerManagedAuth({
  reason: AUTH_REASON,
  permissions: ["traces:create"],
  credential: "apiKey",
});

const secured = createServiceApp({ basePath: "/api/otel/v1" });

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
 * filter CloudWatch by SDK shape. Ingestion keys are ordinary `sk-lw-`
 * API keys, so they classify as `legacy` here — the ingest discriminator
 * lives on the resolved ApiKey row, not the token prefix.
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
async function authenticate(
  c: RouteContext,
  logger: ReturnType<typeof createLogger>,
) {
  const diag = collectAuthDiagnostics(c);
  const credentials = extractCredentials((name) => c.req.header(name));

  if (!credentials) {
    logger.warn(
      diag,
      diag.hasEmptyAuthToken
        ? "Authentication failed: X-Auth-Token sent but empty"
        : "Authentication failed: no auth header present",
    );
    const message =
      "Authentication token is required. Use X-Auth-Token header or Authorization: Bearer token.";
    return { error: message, status: 401 as const, body: { message } };
  }

  let resolved;
  try {
    resolved = await tokenResolver.resolve({
      token: credentials.token,
      projectId: credentials.projectId,
    });
  } catch (error) {
    logger.error({ ...diag, error }, "Database error during authentication");
    const message = "Authentication service error.";
    return { error: message, status: 500 as const, body: { message } };
  }

  if (!resolved) {
    const tokenType = classifyTokenType(credentials.token);
    logger.warn(
      {
        ...diag,
        tokenType,
        hasProjectId: !!credentials.projectId,
      },
      "Authentication failed: invalid credentials",
    );
    const message = "Invalid auth token.";
    return { error: message, status: 401 as const, body: { message } };
  }

  // Enforce API-key ceiling (legacy tokens bypass). `traces:create` gates write
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
    return {
      error: denial.message,
      status: denial.status,
      body: denial.body,
    };
  }

  return { project: resolved.project, resolved };
}

/**
 * Checks usage limits for the project and throws PlanLimitExceededError (402)
 * if exceeded. Logs `Project has reached plan limit` with `customerTraceIds`
 * so a customer-supplied trace_id can be matched to the rejection. The lookup
 * itself is wrapped in try/catch — on lookup failure we log and let the
 * request through (same behaviour as before); the thrown limit error lives
 * outside that try block so it is never mistaken for a lookup failure.
 */
async function enforcePlanLimit({
  project,
  customerTraceIds,
  logger,
}: {
  project: { id: string; teamId: string; team: { organizationId: string } };
  customerTraceIds: string[];
  logger: ReturnType<typeof createLogger>;
}): Promise<void> {
  let limitResult: UsageLimitResult;
  try {
    limitResult = await getApp().usage.checkLimit({
      teamId: project.teamId,
    });
  } catch (error) {
    logger.error(
      { error, projectId: project.id, customerTraceIds },
      "Error checking trace limit",
    );
    captureException(error as Error, {
      extra: { projectId: project.id },
    });
    return;
  }

  if (!limitResult.exceeded) return;

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

  // 402, not 429: the OTel SDKs treat 429 as retryable and will re-post the
  // same batch until their elapsed-time budget runs out. A plan limit is
  // terminal for that payload, so a retryable status turns one rejection
  // into an unbounded loop against a customer who cannot succeed.
  throw new PlanLimitExceededError(limitResult.message, {
    currentMonthMessagesCount: limitResult.count,
    maxMessagesPerMonth: limitResult.maxMessagesPerMonth,
    activePlanName: limitResult.planName,
  });
}

/**
 * Everything the receiver writes onto an OTLP request on its own authority,
 * for one signal. Two rules with different scopes live here together because
 * they are the same concern (what the payload is not allowed to decide) and
 * because they must not drift apart:
 *
 *   - `langwatch.api_key.id` is rewritten on EVERY authenticated request. The
 *     redaction deny-list exempts that name, which is only sound while the
 *     value cannot come from the payload, so this must never become
 *     conditional. See enforceApiKeyIdOnTraceRequest.
 *   - The ingest-key provenance stamp (source / origin / organization_id /
 *     template.id) applies only to ingestion-key traffic, which is the only
 *     traffic that has a source identity to claim.
 *
 * The casts bridge nullability differences between the OTLP SDK types and the
 * structural slice these helpers mutate (resource → attributes); neither helper
 * reads the deeper fields that differ.
 */
async function applyReceiverProvenanceToTraces({
  request,
  resolved,
}: {
  request: IExportTraceServiceRequest;
  resolved: Awaited<ReturnType<typeof tokenResolver.resolve>>;
}): Promise<void> {
  const typedRequest = request as unknown as Parameters<
    typeof enforceApiKeyIdOnTraceRequest
  >[0];
  enforceApiKeyIdOnTraceRequest(
    typedRequest,
    resolved?.type === "apiKey" ? resolved.apiKeyId : null,
  );

  if (resolved?.type !== "apiKey" || !resolved.ingestSourceType) return;

  // Whether this tool's direct-OTLP usage is bundled (non-billed per token).
  // Cached per (org, sourceType); drives the trace summary's billed-vs-non-
  // billed cost split. Gateway usage never reaches here.
  const nonBillable = await resolveSourceNonBillable({
    organizationId: resolved.organizationId,
    sourceType: resolved.ingestSourceType,
  });
  stampIngestKeyProvenanceOnTraceRequest(
    request as unknown as Parameters<
      typeof stampIngestKeyProvenanceOnTraceRequest
    >[0],
    {
      apiKeyId: resolved.apiKeyId,
      sourceType: resolved.ingestSourceType,
      organizationId: resolved.organizationId,
      templateId: resolved.ingestionTemplateId,
      nonBillable,
    },
  );
}

/** {@link applyReceiverProvenanceToTraces} for the logs signal. */
async function applyReceiverProvenanceToLogs({
  request,
  resolved,
}: {
  request: unknown;
  resolved: Awaited<ReturnType<typeof tokenResolver.resolve>>;
}): Promise<void> {
  enforceApiKeyIdOnLogRequest(
    request as Parameters<typeof enforceApiKeyIdOnLogRequest>[0],
    resolved?.type === "apiKey" ? resolved.apiKeyId : null,
  );

  if (resolved?.type !== "apiKey" || !resolved.ingestSourceType) return;

  // Log-based tools (Claude Code et al. emit OTLP logs, not spans) need the
  // same bundled-vs-billed resolution the trace path does; without it their
  // cost never gets the non-billable marker and a bundled coding session reads
  // as real spend.
  const nonBillable = await resolveSourceNonBillable({
    organizationId: resolved.organizationId,
    sourceType: resolved.ingestSourceType,
  });
  stampIngestKeyProvenanceOnLogRequest(
    request as Parameters<typeof stampIngestKeyProvenanceOnLogRequest>[0],
    {
      apiKeyId: resolved.apiKeyId,
      sourceType: resolved.ingestSourceType,
      organizationId: resolved.organizationId,
      templateId: resolved.ingestionTemplateId,
      nonBillable,
    },
  );
}

/** {@link applyReceiverProvenanceToTraces} for the metrics signal. */
function applyReceiverProvenanceToMetrics({
  request,
  resolved,
}: {
  request: unknown;
  resolved: Awaited<ReturnType<typeof tokenResolver.resolve>>;
}): void {
  enforceApiKeyIdOnMetricRequest(
    request as Parameters<typeof enforceApiKeyIdOnMetricRequest>[0],
    resolved?.type === "apiKey" ? resolved.apiKeyId : null,
  );

  if (resolved?.type !== "apiKey" || !resolved.ingestSourceType) return;

  stampIngestKeyProvenanceOnMetricRequest(
    request as Parameters<typeof stampIngestKeyProvenanceOnMetricRequest>[0],
    {
      apiKeyId: resolved.apiKeyId,
      sourceType: resolved.ingestSourceType,
      organizationId: resolved.organizationId,
      templateId: resolved.ingestionTemplateId,
    },
  );
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

secured
  .access(otelIngestAuth)
  .post("/traces", bodyLimit({ maxSize: OTLP_MAX_BODY_BYTES }), async (c) => {
    const tracer = getLangWatchTracer("langwatch.otel.traces");

    return tracer.withActiveSpan(
      "TracesV1.handleTracesRequest",
      { kind: SpanKind.SERVER },
      async (span) => {
        // Auth first — 401s/permission failures should not pay body decompression
        // cost, and body content is irrelevant when we don't know who's calling.
        const authResult = await authenticate(c, loggerTraces);

        if ("error" in authResult) {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: authResult.error,
          });
          return c.json(authResult.body, { status: authResult.status });
        }

        const { project, resolved } = authResult;
        span.setAttribute("langwatch.project.id", project.id);

        const body = await readOtlpBody(c.req.raw);
        const contentType = c.req.header("content-type");

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

        await enforcePlanLimit({
          project,
          customerTraceIds,
          logger: loggerTraces,
        });

        const emptyPartialSuccess = { rejectedSpans: 0, errorMessage: "" };

        if (body.byteLength === 0) {
          loggerTraces.debug(
            { projectId: project.id },
            "Received empty trace request, ignoring",
          );
          return c.json({
            message: "No traces to process",
            partialSuccess: emptyPartialSuccess,
          });
        }

        const parsed = parseOtlpTraces(body, contentType);
        if (!parsed.ok) {
          loggerTraces.error(
            {
              error: parsed.error,
              projectId: project.id,
              customerTraceIds,
              ...bodyForensics(body),
            },
            "error parsing traces",
          );
          captureException(new Error(parsed.error), {
            extra: {
              projectId: project.id,
              customerTraceIds,
            },
          });
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: "Failed to parse traces",
          });
          return c.json({ error: "Failed to parse traces" }, { status: 400 });
        }
        const traceRequest = parsed.request;

        // Body successfully parsed — mark the API key as used
        if (resolved.type === "apiKey") {
          tokenResolver.markUsed({ apiKeyId: resolved.apiKeyId });
        }

        await applyReceiverProvenanceToTraces({
          request: traceRequest,
          resolved,
        });

        const collectionResult =
          await getApp().traces.collection.handleOtlpTraceRequest(
            project.id,
            traceRequest,
            DEFAULT_PII_REDACTION_LEVEL,
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

secured
  .access(otelIngestAuth)
  .post("/logs", bodyLimit({ maxSize: OTLP_MAX_BODY_BYTES }), async (c) => {
    const tracer = getLangWatchTracer("langwatch.otel.logs");

    return tracer.withActiveSpan(
      "[POST] /api/otel/v1/logs",
      { kind: SpanKind.SERVER },
      async (span) => {
        const authResult = await authenticate(c, loggerLogs);

        if ("error" in authResult) {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: authResult.error,
          });
          return c.json(authResult.body, { status: authResult.status });
        }

        const { project, resolved } = authResult;
        span.setAttribute("langwatch.project.id", project.id);

        await enforcePlanLimit({
          project,
          customerTraceIds: [],
          logger: loggerLogs,
        });

        const body = await readOtlpBody(c.req.raw);
        const parsed = parseOtlpLogs(body, c.req.header("content-type"));
        if (!parsed.ok) {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: "Failed to parse logs",
          });
          span.recordException(new Error(parsed.error));
          loggerLogs.error(
            {
              error: parsed.error,
              projectId: project.id,
              ...bodyForensics(body),
            },
            "error parsing logs",
          );
          captureException(new Error(parsed.error), {
            extra: {
              projectId: project.id,
            },
          });
          return c.json({ error: "Failed to parse logs" }, { status: 400 });
        }
        const logRequest = parsed.request;

        // Body successfully parsed — mark the API key as used
        if (resolved.type === "apiKey") {
          tokenResolver.markUsed({ apiKeyId: resolved.apiKeyId });
        }

        await applyReceiverProvenanceToLogs({
          request: logRequest,
          resolved,
        });

        const result = await getApp().traces.logCollection.handleOtlpLogRequest(
          {
            tenantId: project.id,
            organizationId: project.team.organizationId,
            logRequest,
            piiRedactionLevel: DEFAULT_PII_REDACTION_LEVEL,
          },
        );

        // Nothing was durably accepted, and the cause is ours. OTLP treats a 200
        // with `partialSuccess` as a permanent rejection the client must not
        // re-send, so answering that here would turn a queue blip into fleet-wide
        // data loss. 503 is in OTLP's retryable set.
        if (result.outcome === "unavailable") {
          return c.json({ error: result.errorMessage }, { status: 503 });
        }

        return c.json(
          result.rejectedLogRecords > 0
            ? {
                partialSuccess: {
                  rejectedLogRecords: result.rejectedLogRecords,
                  ...(result.errorMessage
                    ? { errorMessage: result.errorMessage }
                    : {}),
                },
              }
            : {},
        );
      },
    );
  });

// ── POST /metrics ────────────────────────────────────────────────────

secured
  .access(otelIngestAuth)
  .post("/metrics", bodyLimit({ maxSize: OTLP_MAX_BODY_BYTES }), async (c) => {
    const tracer = getLangWatchTracer("langwatch.otel.metrics");

    return tracer.withActiveSpan(
      "[POST] /api/otel/v1/metrics",
      { kind: SpanKind.SERVER },
      async (span) => {
        const authResult = await authenticate(c, loggerMetrics);

        if ("error" in authResult) {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: authResult.error,
          });
          return c.json(authResult.body, { status: authResult.status });
        }

        const { project, resolved } = authResult;
        span.setAttribute("langwatch.project.id", project.id);

        await enforcePlanLimit({
          project,
          customerTraceIds: [],
          logger: loggerMetrics,
        });

        const body = await readOtlpBody(c.req.raw);
        const parsed = parseOtlpMetrics(body, c.req.header("content-type"));
        if (!parsed.ok) {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: "Failed to parse metrics",
          });
          span.recordException(new Error(parsed.error));
          loggerMetrics.error(
            {
              error: parsed.error,
              projectId: project.id,
              ...bodyForensics(body),
            },
            "error parsing metrics",
          );
          captureException(new Error(parsed.error), {
            extra: {
              projectId: project.id,
            },
          });
          return c.json({ error: "Failed to parse metrics" }, { status: 400 });
        }
        const metricsRequest = parsed.request;

        applyReceiverProvenanceToMetrics({
          request: metricsRequest,
          resolved,
        });

        // Body successfully parsed — mark the API key as used
        if (resolved.type === "apiKey") {
          tokenResolver.markUsed({ apiKeyId: resolved.apiKeyId });
        }

        const result =
          await getApp().traces.metricCollection.handleOtlpMetricRequest({
            tenantId: project.id,
            organizationId: project.team.organizationId,
            metricRequest: metricsRequest,
            piiRedactionLevel: DEFAULT_PII_REDACTION_LEVEL,
          });

        // Nothing was durably accepted, and the cause is ours. OTLP treats a 200
        // with `partialSuccess` as a permanent rejection the client must not
        // re-send, so answering that here would turn a queue blip into fleet-wide
        // data loss. 503 is in OTLP's retryable set.
        if (result.outcome === "unavailable") {
          return c.json({ error: result.errorMessage }, { status: 503 });
        }

        if (result.rejectedDataPoints === 0) return c.json({});
        return c.json({
          partialSuccess: {
            rejectedDataPoints: result.rejectedDataPoints,
            ...(result.errorMessage
              ? { errorMessage: result.errorMessage }
              : {}),
          },
        });
      },
    );
  });

export const app = secured.hono;
