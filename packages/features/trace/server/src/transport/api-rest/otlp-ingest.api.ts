/**
 * The OTLP receiver: `POST /api/otel/v1/{traces,logs,metrics}`.
 *
 * This is the deployment's critical path. Everything about its shape is
 * decided by what an OpenTelemetry exporter does with the answer, not by what
 * reads best:
 *
 *   - AUTH RUNS BEFORE THE BODY IS READ. A 401 must not pay for decompressing
 *     a batch, and the bytes are irrelevant while we do not know whose they
 *     are.
 *   - A PLAN LIMIT IS 402, NEVER 429. The OTel SDKs treat 429 as transient and
 *     re-post the same batch until their elapsed-time budget runs out, so a
 *     retryable status turns one rejection into an unbounded loop against a
 *     customer who cannot succeed until they upgrade.
 *   - A FAILURE THAT IS OURS IS 503, NEVER `partialSuccess`. OTLP reads a 200
 *     carrying `partialSuccess` as a PERMANENT rejection the client must not
 *     re-send, so answering that on a queue blip is fleet-wide data loss.
 *
 * The credential is resolved inside the handler rather than by the framework's
 * authenticate-then-authorize chain, for the reason the annotations family
 * gives: this receiver publishes its own refusal bodies and deployed exporters
 * parse them. It declares `handlerManagedAuth` so the route-policy registry
 * still sees its real permission, and takes the resolution as a port.
 *
 * WHAT IS A PORT, AND WHY. Three things this family cannot hold:
 *
 *   - the CREDENTIAL, because resolving one reads API keys and role bindings
 *     out of the deployment's database;
 *   - the PLAN ALLOWANCE, because the entitlement graph is the process's;
 *   - the COLLECTION for each signal, because a deployment may compose the
 *     trace pipeline without the log or metric one. Each is OPTIONAL and its
 *     route is registered only where its collection exists, so a process that
 *     folds no log records answers 404 to a log export rather than mounting a
 *     handler over a stub that 500s.
 *
 * The ingest-key provenance resolver is optional for the same reason and with
 * a sharper consequence: it decides whether a tool's direct-OTLP usage is
 * bundled or billed. Absent, traffic on an ORDINARY project key is unaffected
 * — it carries no source identity to stamp — and traffic on an INGESTION key
 * is refused by name rather than recorded with provenance nobody resolved.
 */
import { handlerManagedAuth } from "@langwatch/api";
import {
  bodyLimit,
  collectAuthDiagnostics,
  type AppRestSecurity,
  type MountableRestApp,
} from "@langwatch/api/rest";
import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import {
  decodeBase64OpenTelemetryId,
  OTLP_CORRECTED_PATH_HEADER,
  OTLP_MAX_BODY_BYTES,
  parseOtlpLogs,
  parseOtlpMetrics,
  parseOtlpTraces,
  readCorrectedPath,
  readOtlpBody,
} from "@langwatch/otlp";
import { SpanKind, SpanStatusCode } from "@opentelemetry/api";
import type { IExportTraceServiceRequest } from "@opentelemetry/otlp-transformer";
import * as root from "@opentelemetry/otlp-transformer/build/src/generated/root";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { getLangWatchTracer } from "langwatch";

import {
  dropForeignScopesForVscodeKey,
  enforceApiKeyIdOnLogRequest,
  enforceApiKeyIdOnMetricRequest,
  enforceApiKeyIdOnTraceRequest,
  stampIngestKeyProvenanceOnLogRequest,
  stampIngestKeyProvenanceOnMetricRequest,
  stampIngestKeyProvenanceOnTraceRequest,
} from "../../services/ingest-key-provenance.rules";
import type { TraceRequestCollectionResult } from "../../services/trace-ingestion.service";

const traceRequestType = (root as any).opentelemetry.proto.collector.trace.v1
  .ExportTraceServiceRequest;

const loggerTraces = createLogger("langwatch:otel:v1:traces");
const loggerLogs = createLogger("langwatch:otel:v1:logs");
const loggerMetrics = createLogger("langwatch:otel:v1:metrics");

const AUTH_REASON = "OTLP ingestion API key resolved in-handler";

/**
 * The project a receiver writes into.
 *
 * All three fields are read: `id` is the tenant, `teamId` sizes the allowance,
 * and `organizationId` is what a plan and a source's billing resolve on.
 */
export type OtlpIngestProject = Readonly<{
  id: string;
  teamId: string;
  organizationId: string;
}>;

/**
 * What the receiver needs to know about the credential BEYOND which project it
 * opens, stated as its own narrow shape rather than as the API-key contract's
 * resolved token.
 *
 * Narrow on purpose. Everything here is stamped onto the payload on the
 * receiver's own authority, and a wider type would invite a handler to make a
 * decision on a field the payload could also have set.
 */
export type OtlpIngestIdentity = Readonly<{
  /**
   * The scoped key's id, or null for a legacy project key. It is rewritten
   * onto EVERY authenticated request — see {@link enforceApiKeyIdOnTraceRequest}
   * — so it must never become conditional: the redaction deny-list exempts
   * that attribute name, and that exemption is only sound while the value
   * cannot come from the payload.
   */
  apiKeyId: string | null;
  organizationId: string;
  /** Set only on an INGESTION key: which tool's feed this is. */
  ingestSourceType: string | null;
  ingestionTemplateId: string | null;
}>;

/** A resolved credential, or the refusal this family publishes for it. */
export type OtlpIngestCredential =
  | Readonly<{
      ok: true;
      project: OtlpIngestProject;
      identity: OtlpIngestIdentity;
      /** Stamps the key's last-used clock, only once the body has parsed. */
      markUsed: () => void;
    }>
  | Readonly<{ ok: false; status: ContentfulStatusCode; body: object }>;

/** How this process turns a request into a project credential. */
export type OtlpIngestCredentialPort = (input: {
  request: Request;
}) => Promise<OtlpIngestCredential>;

/**
 * The plan allowance, enforced before a byte of the batch is parsed.
 *
 * It THROWS to refuse — the refusal is a `HandledError` the process's error
 * boundary renders — and returns for every other outcome, INCLUDING a lookup
 * that failed. That asymmetry is deliberate and is the behaviour this path has
 * always had: an entitlement store that is down must not stop a customer's
 * telemetry, so a failed lookup lets the batch through.
 */
export type OtlpIngestUsageLimitPort = (input: {
  project: OtlpIngestProject;
  /** Best-effort, for correlating a rejection to a customer-supplied id. */
  customerTraceIds: string[];
}) => Promise<void>;

/** Whether a tool's direct-OTLP usage is bundled rather than billed. */
export type OtlpIngestNonBillablePort = (input: {
  organizationId: string;
  sourceType: string;
}) => Promise<boolean>;

/** The trace signal's collection: raw OTLP in, per-span tally out. */
export type OtlpTraceCollectionPort = (input: {
  tenantId: string;
  traceRequest: IExportTraceServiceRequest;
}) => Promise<TraceRequestCollectionResult | undefined>;

/**
 * The log and metric signals answer a discriminated outcome rather than a
 * counter pair, because `partialSuccess` and "nothing landed, retry" are
 * different instructions to an exporter and a counter cannot tell them apart.
 */
export type OtlpLogCollectionOutcome =
  | Readonly<{
      outcome: "collected";
      rejectedLogRecords: number;
      errorMessage?: string | undefined;
    }>
  | Readonly<{ outcome: "unavailable"; errorMessage: string }>;

export type OtlpLogCollectionPort = (input: {
  tenantId: string;
  organizationId: string;
  logRequest: unknown;
}) => Promise<OtlpLogCollectionOutcome>;

export type OtlpMetricCollectionOutcome =
  | Readonly<{
      outcome: "collected";
      rejectedDataPoints: number;
      errorMessage?: string | undefined;
    }>
  | Readonly<{ outcome: "unavailable"; errorMessage: string }>;

export type OtlpMetricCollectionPort = (input: {
  tenantId: string;
  organizationId: string;
  metricRequest: unknown;
}) => Promise<OtlpMetricCollectionOutcome>;

/** Reports a failure the receiver answered but did not raise. */
export type OtlpIngestErrorReportPort = (
  error: Error,
  context: Readonly<{ projectId: string; customerTraceIds: string[] }>,
) => void;

export type OtlpIngestRestPorts = Readonly<{
  credential: OtlpIngestCredentialPort;
  usageLimit: OtlpIngestUsageLimitPort;
  traces?: OtlpTraceCollectionPort | undefined;
  logs?: OtlpLogCollectionPort | undefined;
  metrics?: OtlpMetricCollectionPort | undefined;
  nonBillable?: OtlpIngestNonBillablePort | undefined;
  reportError?: OtlpIngestErrorReportPort | undefined;
}>;

/**
 * An ingestion key arrived on a process that resolves no source billing.
 *
 * 503 and `platform` fault: the customer's key is valid and their payload is
 * fine, and a retry against a deployment that composes the governance graph
 * succeeds. Stamping the provenance with a guessed `nonBillable` instead would
 * silently price a bundled coding session as real spend, which is the one
 * outcome worse than refusing.
 */
class OtlpIngestSourceBillingUnavailableError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor(sourceType: string) {
    super(
      "service_unavailable",
      "This deployment cannot resolve the billing treatment for an ingestion key's source, so it will not record traffic sent on one.",
      {
        meta: { sourceType },
        httpStatus: 503,
        fault: "platform",
        retryable: true,
      },
    );
    this.name = "OtlpIngestSourceBillingUnavailableError";
  }
}

/**
 * A rejected OTLP body is unparsed, so it has not been through PII redaction.
 * Only its length may be recorded: the bytes carry prompts, completions and
 * host identifiers, and a log sink is not a place customer content may reach.
 */
function bodyForensics(body: ArrayBuffer | Uint8Array) {
  return { bodyBytes: body.byteLength };
}

/**
 * Classifies a token by prefix without exposing the value, so on-call can
 * filter a 401 stream by SDK shape. Ingestion keys are ordinary `sk-lw-` API
 * keys and classify as `legacy` here — the ingest discriminator lives on the
 * resolved row, not on the token prefix.
 */
export function classifyTokenType(token: string): "pat" | "legacy" | "unknown" {
  if (token.startsWith("pat-lw-")) return "pat";
  if (token.startsWith("sk-lw-")) return "legacy";
  return "unknown";
}

/**
 * A misconfigured exporter fleet posts continuously and the signal — which
 * project, which path — is identical on every batch, so a pair is reported at
 * most once a window. Repetition costs money on an ingestion hot path and
 * carries no information the first line did not.
 *
 * The map is bounded rather than grown: past the cap it is cleared wholesale,
 * which costs one extra line per live pair afterwards and cannot leak.
 */
const CORRECTED_PATH_LOG_WINDOW_MS = 10 * 60 * 1000;
const CORRECTED_PATH_LOG_MAX_PAIRS = 1000;
const correctedPathLastLoggedAt = new Map<string, number>();

function correctedPathIsDueToLog({ pair, now }: { pair: string; now: number }): boolean {
  const last = correctedPathLastLoggedAt.get(pair);
  if (last !== void 0 && now - last < CORRECTED_PATH_LOG_WINDOW_MS) return false;

  if (correctedPathLastLoggedAt.size >= CORRECTED_PATH_LOG_MAX_PAIRS) {
    correctedPathLastLoggedAt.clear();
  }
  correctedPathLastLoggedAt.set(pair, now);
  return true;
}

/**
 * Records that this request reached us on a path a misconfigured exporter
 * produced. Logged here rather than at the alias because the project is what
 * makes it actionable: it is the difference between "somebody's exporter is
 * misconfigured" and knowing whose.
 */
function logCorrectedPath({
  c,
  projectId,
  logger,
}: {
  c: Context;
  projectId: string;
  logger: ReturnType<typeof createLogger>;
}): void {
  const originalPath = readCorrectedPath(c.req.header(OTLP_CORRECTED_PATH_HEADER));
  if (!originalPath) return;
  // A NUL joins the pair because it cannot appear in a URL pathname, so no
  // project and path can collide with a different pair.
  const pair = [projectId, originalPath].join(" ");
  if (!correctedPathIsDueToLog({ pair, now: Date.now() })) return;

  logger.warn(
    { projectId, originalPath, canonicalPath: c.req.path },
    "OTLP exporter posted to a non-canonical path; served from the canonical route",
  );
}

type AuthenticatedRequest =
  | Readonly<{
      project: OtlpIngestProject;
      identity: OtlpIngestIdentity;
      markUsed: () => void;
    }>
  | Readonly<{ refusal: { status: ContentfulStatusCode; body: object } }>;

/**
 * Resolves the credential and logs an auth-diagnostic fingerprint on every
 * failure path, so on-call can attribute a 401 to a specific customer and SDK
 * without asking them to reproduce it.
 */
async function authenticate(
  c: Context,
  credential: OtlpIngestCredentialPort,
  logger: ReturnType<typeof createLogger>,
): Promise<AuthenticatedRequest> {
  const diagnostics = collectAuthDiagnostics(c.req);
  const resolution = await credential({ request: c.req.raw });

  if (!resolution.ok) {
    logger.warn(
      { ...diagnostics, refusalStatus: resolution.status },
      diagnostics.hasEmptyAuthToken
        ? "Authentication failed: X-Auth-Token sent but empty"
        : "Authentication failed",
    );
    return { refusal: { status: resolution.status, body: resolution.body } };
  }

  logCorrectedPath({ c, projectId: resolution.project.id, logger });
  return {
    project: resolution.project,
    identity: resolution.identity,
    markUsed: resolution.markUsed,
  };
}

/**
 * Everything the receiver writes onto an OTLP request on its own authority,
 * for one signal. Two rules with different scopes live together because they
 * are the same concern — what the payload is not allowed to decide — and must
 * not drift apart.
 *
 * The casts bridge nullability differences between the OTLP SDK types and the
 * structural slice these helpers mutate (resource then attributes); neither
 * helper reads the deeper fields that differ.
 */
async function applyReceiverProvenance({
  request,
  identity,
  nonBillable,
  signal,
  logger,
}: {
  request: unknown;
  identity: OtlpIngestIdentity;
  nonBillable: OtlpIngestNonBillablePort | undefined;
  signal: "traces" | "logs" | "metrics";
  logger: ReturnType<typeof createLogger>;
}): Promise<void> {
  if (signal === "traces") {
    enforceApiKeyIdOnTraceRequest(
      request as Parameters<typeof enforceApiKeyIdOnTraceRequest>[0],
      identity.apiKeyId,
    );
  } else if (signal === "logs") {
    enforceApiKeyIdOnLogRequest(
      request as Parameters<typeof enforceApiKeyIdOnLogRequest>[0],
      identity.apiKeyId,
    );
  } else {
    enforceApiKeyIdOnMetricRequest(
      request as Parameters<typeof enforceApiKeyIdOnMetricRequest>[0],
      identity.apiKeyId,
    );
  }

  const sourceType = identity.ingestSourceType;
  if (identity.apiKeyId === null || !sourceType) return;

  // A copilot_vscode key rides spec-standard OTEL_* env in a long-lived
  // editor; processes VS Code spawns outside integrated terminals (js-debug
  // internal console, extension children) inherit it, so a developer's own
  // instrumented service could POST here under this key. Only Copilot's
  // instrumentation scopes pass. The metrics signal needs the same gate: the
  // code() env enables OTEL_METRICS_EXPORTER too.
  if (signal !== "logs") {
    const droppedForeign = dropForeignScopesForVscodeKey(
      request as Parameters<typeof dropForeignScopesForVscodeKey>[0],
      sourceType,
    );
    if (droppedForeign > 0) {
      logger.warn(
        { droppedForeign, apiKeyId: identity.apiKeyId },
        "dropped non-copilot instrumentation scopes posted on a copilot_vscode ingest key",
      );
    }
  }

  if (!nonBillable) throw new OtlpIngestSourceBillingUnavailableError(sourceType);

  // Whether this tool's direct-OTLP usage is bundled (non-billed per token).
  // Log-based tools (Claude Code et al. emit OTLP logs, not spans) need the
  // same resolution the trace path does; without it a bundled coding session
  // reads as real spend.
  const bundled = await nonBillable({
    organizationId: identity.organizationId,
    sourceType,
  });
  const stamp = {
    apiKeyId: identity.apiKeyId,
    sourceType,
    organizationId: identity.organizationId,
    templateId: identity.ingestionTemplateId,
  };
  if (signal === "traces") {
    stampIngestKeyProvenanceOnTraceRequest(
      request as Parameters<typeof stampIngestKeyProvenanceOnTraceRequest>[0],
      { ...stamp, nonBillable: bundled },
    );
  } else if (signal === "logs") {
    stampIngestKeyProvenanceOnLogRequest(
      request as Parameters<typeof stampIngestKeyProvenanceOnLogRequest>[0],
      { ...stamp, nonBillable: bundled },
    );
  } else {
    // The metric stamp carries no billing marker: a metric point is not a
    // token, so there is nothing on it to price.
    stampIngestKeyProvenanceOnMetricRequest(
      request as Parameters<typeof stampIngestKeyProvenanceOnMetricRequest>[0],
      stamp,
    );
  }
}

/**
 * Best-effort extraction of customer trace_ids from an OTLP traces body.
 * Never throws — an empty, malformed or unparsable body yields an empty array.
 * Used to tag rejection logs so a customer who reports "I sent trace_id X and
 * it never appeared" can be matched to the rejection.
 *
 * JSON-OTLP serialises trace_id as base64; protobuf-OTLP decodes it as bytes.
 * `decodeBase64OpenTelemetryId` handles both, always answering lowercase hex.
 */
export function peekCustomerTraceIds(
  body: ArrayBuffer,
  contentType: string | undefined,
  max = 10,
): string[] {
  if (!body || body.byteLength === 0) return [];
  // Normalise so "application/json; charset=utf-8" is recognised: the OTLP
  // HTTP spec lets exporters append parameters and case is not guaranteed.
  const mediaType = contentType?.split(";", 1)[0]?.trim().toLowerCase();
  let request: IExportTraceServiceRequest;
  try {
    if (mediaType === "application/json") {
      request = JSON.parse(Buffer.from(body).toString("utf-8"));
    } else {
      request = traceRequestType.decode(new Uint8Array(body));
    }
  } catch {
    return [];
  }
  const ids = new Set<string>();
  for (const resourceSpans of request.resourceSpans ?? []) {
    for (const scopeSpans of resourceSpans.scopeSpans ?? []) {
      for (const span of scopeSpans.spans ?? []) {
        const decoded = decodeBase64OpenTelemetryId(span.traceId);
        if (decoded) {
          ids.add(decoded);
          if (ids.size >= max) return Array.from(ids);
        }
      }
    }
  }
  return Array.from(ids);
}

/**
 * The OTLP receiver, over whichever signals this process composed.
 *
 * ORDERING inside the family is free — the three routes own disjoint literal
 * paths. Ordering against its SIBLINGS is not: the path-alias re-dispatcher
 * must mount AFTER this one, because it forwards into these routes.
 */
export function createOtlpIngestRestApp(options: {
  security: AppRestSecurity;
  ports: OtlpIngestRestPorts;
}): MountableRestApp {
  const { security, ports } = options;
  const secured = security.createServiceApp({ basePath: "/api/otel/v1" });

  // One policy for all three OTLP signals: traces, logs and metrics are the
  // same write to the same tenant, so they answer to the same permission.
  const otelIngestAuth = handlerManagedAuth({
    reason: AUTH_REASON,
    permissions: ["traces:create"],
    credential: "apiKey",
  });

  const traces = ports.traces;
  if (traces) {
    secured
      .access(otelIngestAuth)
      .post("/traces", bodyLimit({ maxSize: OTLP_MAX_BODY_BYTES }), async (c) => {
        const tracer = getLangWatchTracer("langwatch.otel.traces");

        return tracer.withActiveSpan(
          "TracesV1.handleTracesRequest",
          { kind: SpanKind.SERVER },
          async (span) => {
            // Auth first — a 401 must not pay for body decompression, and the
            // body is irrelevant while we do not know who is calling.
            const authenticated = await authenticate(c, ports.credential, loggerTraces);
            if ("refusal" in authenticated) {
              span.setStatus({ code: SpanStatusCode.ERROR, message: "unauthenticated" });
              return c.json(authenticated.refusal.body, {
                status: authenticated.refusal.status,
              });
            }

            const { project, identity, markUsed } = authenticated;
            span.setAttribute("langwatch.project.id", project.id);

            const body = await readOtlpBody(c.req.raw);
            const contentType = c.req.header("content-type");

            const customerTraceIds = peekCustomerTraceIds(body, contentType);
            if (customerTraceIds.length > 0) {
              span.setAttribute("langwatch.otel.customer_trace_ids", customerTraceIds.join(","));
            }

            await ports.usageLimit({ project, customerTraceIds });

            if (body.byteLength === 0) {
              loggerTraces.debug(
                { projectId: project.id },
                "Received empty trace request, ignoring",
              );
              return c.json({
                message: "No traces to process",
                partialSuccess: { rejectedSpans: 0, errorMessage: "" },
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
              ports.reportError?.(new Error(parsed.error), {
                projectId: project.id,
                customerTraceIds,
              });
              span.setStatus({ code: SpanStatusCode.ERROR, message: "Failed to parse traces" });
              return c.json({ error: "Failed to parse traces" }, { status: 400 });
            }

            // Body successfully parsed — only now is the key marked used.
            markUsed();

            await applyReceiverProvenance({
              request: parsed.request,
              identity,
              nonBillable: ports.nonBillable,
              signal: "traces",
              logger: loggerTraces,
            });

            const result = await traces({
              tenantId: project.id,
              traceRequest: parsed.request,
            });

            return c.json({
              message: "Trace received successfully.",
              partialSuccess: {
                rejectedSpans: result?.rejectedSpans ?? 0,
                errorMessage: result?.errorMessage ?? "",
              },
            });
          },
        );
      });
  }

  const logs = ports.logs;
  if (logs) {
    secured
      .access(otelIngestAuth)
      .post("/logs", bodyLimit({ maxSize: OTLP_MAX_BODY_BYTES }), async (c) => {
        const tracer = getLangWatchTracer("langwatch.otel.logs");

        return tracer.withActiveSpan(
          "[POST] /api/otel/v1/logs",
          { kind: SpanKind.SERVER },
          async (span) => {
            const authenticated = await authenticate(c, ports.credential, loggerLogs);
            if ("refusal" in authenticated) {
              span.setStatus({ code: SpanStatusCode.ERROR, message: "unauthenticated" });
              return c.json(authenticated.refusal.body, {
                status: authenticated.refusal.status,
              });
            }

            const { project, identity, markUsed } = authenticated;
            span.setAttribute("langwatch.project.id", project.id);

            await ports.usageLimit({ project, customerTraceIds: [] });

            const body = await readOtlpBody(c.req.raw);
            const parsed = parseOtlpLogs(body, c.req.header("content-type"));
            if (!parsed.ok) {
              span.setStatus({ code: SpanStatusCode.ERROR, message: "Failed to parse logs" });
              span.recordException(new Error(parsed.error));
              loggerLogs.error(
                { error: parsed.error, projectId: project.id, ...bodyForensics(body) },
                "error parsing logs",
              );
              ports.reportError?.(new Error(parsed.error), {
                projectId: project.id,
                customerTraceIds: [],
              });
              return c.json({ error: "Failed to parse logs" }, { status: 400 });
            }

            markUsed();

            await applyReceiverProvenance({
              request: parsed.request,
              identity,
              nonBillable: ports.nonBillable,
              signal: "logs",
              logger: loggerLogs,
            });

            const result = await logs({
              tenantId: project.id,
              organizationId: project.organizationId,
              logRequest: parsed.request,
            });

            // Nothing was durably accepted and the cause is ours. OTLP treats a
            // 200 with `partialSuccess` as a permanent rejection the client must
            // not re-send, so answering that here would turn a queue blip into
            // fleet-wide data loss. 503 is in OTLP's retryable set.
            if (result.outcome === "unavailable") {
              return c.json({ error: result.errorMessage }, { status: 503 });
            }

            return c.json(
              result.rejectedLogRecords > 0
                ? {
                    partialSuccess: {
                      rejectedLogRecords: result.rejectedLogRecords,
                      ...(result.errorMessage ? { errorMessage: result.errorMessage } : {}),
                    },
                  }
                : {},
            );
          },
        );
      });
  }

  const metrics = ports.metrics;
  if (metrics) {
    secured
      .access(otelIngestAuth)
      .post("/metrics", bodyLimit({ maxSize: OTLP_MAX_BODY_BYTES }), async (c) => {
        const tracer = getLangWatchTracer("langwatch.otel.metrics");

        return tracer.withActiveSpan(
          "[POST] /api/otel/v1/metrics",
          { kind: SpanKind.SERVER },
          async (span) => {
            const authenticated = await authenticate(c, ports.credential, loggerMetrics);
            if ("refusal" in authenticated) {
              span.setStatus({ code: SpanStatusCode.ERROR, message: "unauthenticated" });
              return c.json(authenticated.refusal.body, {
                status: authenticated.refusal.status,
              });
            }

            const { project, identity, markUsed } = authenticated;
            span.setAttribute("langwatch.project.id", project.id);

            await ports.usageLimit({ project, customerTraceIds: [] });

            const body = await readOtlpBody(c.req.raw);
            const parsed = parseOtlpMetrics(body, c.req.header("content-type"));
            if (!parsed.ok) {
              span.setStatus({ code: SpanStatusCode.ERROR, message: "Failed to parse metrics" });
              span.recordException(new Error(parsed.error));
              loggerMetrics.error(
                { error: parsed.error, projectId: project.id, ...bodyForensics(body) },
                "error parsing metrics",
              );
              ports.reportError?.(new Error(parsed.error), {
                projectId: project.id,
                customerTraceIds: [],
              });
              return c.json({ error: "Failed to parse metrics" }, { status: 400 });
            }

            await applyReceiverProvenance({
              request: parsed.request,
              identity,
              nonBillable: ports.nonBillable,
              signal: "metrics",
              logger: loggerMetrics,
            });

            markUsed();

            const result = await metrics({
              tenantId: project.id,
              organizationId: project.organizationId,
              metricRequest: parsed.request,
            });

            if (result.outcome === "unavailable") {
              return c.json({ error: result.errorMessage }, { status: 503 });
            }

            if (result.rejectedDataPoints === 0) return c.json({});
            return c.json({
              partialSuccess: {
                rejectedDataPoints: result.rejectedDataPoints,
                ...(result.errorMessage ? { errorMessage: result.errorMessage } : {}),
              },
            });
          },
        );
      });
  }

  return secured.hono;
}
