/**
 * The OTLP receiver: `POST /api/otel/v1/{traces,logs,metrics}`.
 */
import { handlerManagedAuth } from "@langwatch/api";
import {
  bodyLimit,
  collectAuthDiagnostics,
  type AppRestSecurity,
  type MountableRestApp,
} from "@langwatch/api/rest";
import { HandledError } from "@langwatch/handled-error";
import { createLogger, type Logger } from "@langwatch/observability";
import {
  applyOtlpReceiverPolicy,
  type OtlpReceiverPolicy,
  type OtlpReceiverRequest,
  decodeBase64OpenTelemetryId,
  OTLP_CORRECTED_PATH_HEADER,
  OTLP_MAX_BODY_BYTES,
  parseOtlpLogs,
  parseOtlpMetrics,
  parseOtlpTraces,
  otlpProtobufRoot,
  readCorrectedPath,
  readOtlpBody,
} from "@langwatch/otlp";
import { SpanKind, SpanStatusCode, type Span } from "@opentelemetry/api";
import type { IExportTraceServiceRequest } from "@opentelemetry/otlp-transformer";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { getLangWatchTracer } from "langwatch";

import type { TraceRequestCollectionResult } from "../../services/trace-ingestion.service.ts";
import { nowInstant } from "@langwatch/time";

/**
 * The generated protobuf message this receiver decodes into.
 */
const traceRequestType =
  otlpProtobufRoot.opentelemetry.proto.collector.trace.v1.ExportTraceServiceRequest;

const loggerTraces = createLogger("langwatch:otel:v1:traces");
const loggerLogs = createLogger("langwatch:otel:v1:logs");
const loggerMetrics = createLogger("langwatch:otel:v1:metrics");

const AUTH_REASON = "OTLP ingestion API key resolved in-handler";

/**
 * The project a receiver writes into.
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
 */
export type OtlpIngestIdentity = Readonly<{
  /**
   * The scoped key's id, or null for a legacy project key. Rewritten onto
   * every authenticated request (see {@link applyOtlpReceiverPolicy})
   * and must never become conditional: the redaction deny-list exempts this
   * attribute name, sound only while the value cannot come from the payload.
   */
  apiKeyId: string | null;
  organizationId: string;
  /** Set only on an INGESTION key: which tool's feed this is. */
  ingestSourceType: string | null;
  ingestionTemplateId: string | null;
  sourcePolicy?:
    | { status: "ready"; policies: Record<"traces" | "logs" | "metrics", OtlpReceiverPolicy> }
    | { status: "failed"; error: unknown };
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
 */
export type OtlpIngestUsageLimitPort = (input: {
  project: OtlpIngestProject;
  /** Best-effort, for correlating a rejection to a customer-supplied id. */
  customerTraceIds: string[];
}) => Promise<void>;

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
  reportError?: OtlpIngestErrorReportPort | undefined;
}>;

/**
 * An ingestion key arrived on a process that resolves no source billing.
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
 * filter a 401 stream by SDK shape. Ingestion keys are ordinary `sk-lw-`
 * API keys and classify as `legacy` here — the ingest discriminator lives
 * on the resolved row, not the token prefix.
 */
export function classifyTokenType(token: string): "pat" | "legacy" | "unknown" {
  if (token.startsWith("pat-lw-")) return "pat";
  if (token.startsWith("sk-lw-")) return "legacy";
  return "unknown";
}

/**
 * A misconfigured exporter fleet posts continuously with an identical
 * project/path signal on every batch, so a pair is reported at most once a
 * window — repetition costs money on an ingestion hot path for no new
 * information.
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
 * produced. Logged here (not at the alias) since the project id is what
 * makes it actionable — the difference between knowing something is
 * misconfigured and knowing whose.
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
  const pair = [projectId, originalPath].join("\u0000");
  const isDueToLog = correctedPathIsDueToLog({ pair, now: nowInstant().epochMilliseconds });
  if (!isDueToLog) return;

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

function applyReceiverProvenance({
  request,
  identity,
  signal,
  logger,
}: {
  request: OtlpReceiverRequest;
  identity: OtlpIngestIdentity;
  signal: "traces" | "logs" | "metrics";
  logger: Logger;
}): void {
  const isIngestionKey = identity.apiKeyId !== null && Boolean(identity.ingestSourceType);
  const source = identity.sourcePolicy;
  if (isIngestionKey && !source) {
    throw new OtlpIngestSourceBillingUnavailableError(identity.ingestSourceType ?? "");
  }

  if (isIngestionKey && source?.status === "failed") {
    throw source.error;
  }

  const policy = isIngestionKey && source?.status === "ready" ? source.policies[signal] : void 0;
  const { droppedScopes } = applyOtlpReceiverPolicy(request, signal, identity.apiKeyId, policy);

  if (droppedScopes > 0) {
    logger.warn(
      { droppedForeign: droppedScopes, apiKeyId: identity.apiKeyId },
      "dropped instrumentation scopes outside the authenticated ingestion policy",
    );
  }
}

/**
 * Best-effort extraction of customer trace_ids from an OTLP traces body.
 * Never throws — an empty, malformed or unparsable body yields an empty
 * array. Tags rejection logs so "I sent trace_id X and it never appeared"
 * can be matched to the rejection.
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
  const ids = collectDecodedTraceIds(request, max);
  return Array.from(ids);
}

/** Walks every span in the request, decoding trace ids until `max` are collected. */
function collectDecodedTraceIds(request: IExportTraceServiceRequest, max: number): Set<string> {
  const ids = new Set<string>();
  for (const resourceSpans of request.resourceSpans ?? []) {
    for (const scopeSpans of resourceSpans.scopeSpans ?? []) {
      for (const span of scopeSpans.spans ?? []) {
        const decoded = decodeBase64OpenTelemetryId(span.traceId);
        if (!decoded) continue;
        ids.add(decoded);
        if (ids.size >= max) return ids;
      }
    }
  }
  return ids;
}

/** The app the three signal routes register on. */
type OtlpSecuredApp = ReturnType<AppRestSecurity["createServiceApp"]>;

/** The whole of one `POST /api/otel/v1/traces` request, inside its server span. */
async function handleTracesRequest(
  c: Context,
  span: Span,
  ports: OtlpIngestRestPorts,
  traces: OtlpTraceCollectionPort,
): Promise<Response> {
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

  // ONE parse of the body, and the trace ids read off it. The
  // rejection log wants the customer's ids before the plan
  // allowance is weighed, which used to mean parsing the whole
  // batch twice on every request; only the failure branch, where
  // there is no parsed request to read, still parses on its own.
  const parsed = parseOtlpTraces(body, contentType);
  const customerTraceIds = parsed.ok
    ? Array.from(collectDecodedTraceIds(parsed.request, 10))
    : peekCustomerTraceIds(body, contentType);
  if (customerTraceIds.length > 0) {
    span.setAttribute("langwatch.otel.customer_trace_ids", customerTraceIds.join(","));
  }

  await ports.usageLimit({ project, customerTraceIds });

  if (body.byteLength === 0) {
    loggerTraces.debug({ projectId: project.id }, "Received empty trace request, ignoring");
    return c.json({
      message: "No traces to process",
      partialSuccess: { rejectedSpans: 0, errorMessage: "" },
    });
  }

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

  applyReceiverProvenance({
    request: parsed.request,
    identity,
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
}

/** `POST /api/otel/v1/traces`, registered only where the process composed the traces sink. */
function registerTracesRoute(
  secured: OtlpSecuredApp,
  ports: OtlpIngestRestPorts,
  otelIngestAuth: ReturnType<typeof handlerManagedAuth>,
): void {
  const traces = ports.traces;
  if (traces) {
    secured
      .access(otelIngestAuth)
      .post("/traces", bodyLimit({ maxSize: OTLP_MAX_BODY_BYTES }), async (c) => {
        const tracer = getLangWatchTracer("langwatch.otel.traces");

        return tracer.withActiveSpan(
          "TracesV1.handleTracesRequest",
          { kind: SpanKind.SERVER },
          (span) => handleTracesRequest(c, span, ports, traces),
        );
      });
  }
}

/** The whole of one `POST /api/otel/v1/logs` request, inside its server span. */
async function handleLogsRequest(
  c: Context,
  span: Span,
  ports: OtlpIngestRestPorts,
  logs: OtlpLogCollectionPort,
): Promise<Response> {
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

  applyReceiverProvenance({
    request: parsed.request,
    identity,
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
}

/** `POST /api/otel/v1/logs`, registered only where the process composed the logs sink. */
function registerLogsRoute(
  secured: OtlpSecuredApp,
  ports: OtlpIngestRestPorts,
  otelIngestAuth: ReturnType<typeof handlerManagedAuth>,
): void {
  const logs = ports.logs;
  if (logs) {
    secured
      .access(otelIngestAuth)
      .post("/logs", bodyLimit({ maxSize: OTLP_MAX_BODY_BYTES }), async (c) => {
        const tracer = getLangWatchTracer("langwatch.otel.logs");

        return tracer.withActiveSpan(
          "[POST] /api/otel/v1/logs",
          { kind: SpanKind.SERVER },
          (span) => handleLogsRequest(c, span, ports, logs),
        );
      });
  }
}

/** The whole of one `POST /api/otel/v1/metrics` request, inside its server span. */
async function handleMetricsRequest(
  c: Context,
  span: Span,
  ports: OtlpIngestRestPorts,
  metrics: OtlpMetricCollectionPort,
): Promise<Response> {
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

  applyReceiverProvenance({
    request: parsed.request,
    identity,
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
}

/** `POST /api/otel/v1/metrics`, registered only where the process composed the metrics sink. */
function registerMetricsRoute(
  secured: OtlpSecuredApp,
  ports: OtlpIngestRestPorts,
  otelIngestAuth: ReturnType<typeof handlerManagedAuth>,
): void {
  const metrics = ports.metrics;
  if (metrics) {
    secured
      .access(otelIngestAuth)
      .post("/metrics", bodyLimit({ maxSize: OTLP_MAX_BODY_BYTES }), async (c) => {
        const tracer = getLangWatchTracer("langwatch.otel.metrics");

        return tracer.withActiveSpan(
          "[POST] /api/otel/v1/metrics",
          { kind: SpanKind.SERVER },
          (span) => handleMetricsRequest(c, span, ports, metrics),
        );
      });
  }
}

/**
 * The OTLP receiver, over whichever signals this process composed.
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

  registerTracesRoute(secured, ports, otelIngestAuth);
  registerLogsRoute(secured, ports, otelIngestAuth);
  registerMetricsRoute(secured, ports, otelIngestAuth);

  return secured.mountable;
}
