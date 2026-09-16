/**
 * The OTLP receiver: `POST /api/otel/v1/{traces,logs,metrics}`. Declared
 * public since it resolves its own credential via `app.otlpCredential`,
 * so a refusal answers with the credential chain's own status and body.
 */
import {
  collectAuthDiagnostics,
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  type RestRawResult,
} from "@langwatch/api/rest";
import { createLogger, type Logger } from "@langwatch/observability";
import {
  applyOtlpReceiverPolicy,
  type OtlpReceiverPolicy,
  type OtlpReceiverRequest,
  decodeBase64OpenTelemetryId,
  OTLP_CORRECTED_PATH_HEADER,
  otlpProtobufRoot,
  parseOtlpLogs,
  parseOtlpMetrics,
  parseOtlpTraces,
  readCorrectedPath,
  readOtlpBody,
} from "@langwatch/otlp";
import { SpanKind, SpanStatusCode, type Span } from "@opentelemetry/api";
import type { IExportTraceServiceRequest } from "@opentelemetry/otlp-transformer";
import { getLangWatchTracer } from "langwatch";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { HTTPException } from "hono/http-exception";
import { moduleApi } from "@langwatch/runtime-composition";

import { OtlpIngestSourceBillingUnavailableError } from "@langwatch/trace-contract";
import { nowInstant } from "@langwatch/time";
import { resolveRequestBound } from "@langwatch/plans";

/** The project a receiver writes into. */
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
   * every authenticated request, never conditional: the redaction deny-list
   * exempts this name, sound only while it can't come from the payload.
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
export type OtlpIngestCredentialResolver = (input: {
  request: Request;
}) => Promise<OtlpIngestCredential>;

/** The plan allowance, enforced before a byte of the batch is parsed. */
export type OtlpIngestUsageLimit = (input: {
  project: OtlpIngestProject;
  /** Best-effort, for correlating a rejection to a customer-supplied id. */
  customerTraceIds: string[];
}) => Promise<void>;

/** The trace signal's collection: raw OTLP in, per-span tally out. */
export type OtlpTraceCollectionResult = Readonly<{
  rejectedSpans?: number;
  errorMessage?: string;
}>;

export type OtlpTraceCollection = (input: {
  tenantId: string;
  traceRequest: IExportTraceServiceRequest;
}) => Promise<OtlpTraceCollectionResult | undefined>;

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
  | Readonly<{ outcome: "unavailable"; errorMessage: string }>
  /**
   * This deployment composed no log collection, so no batch can ever land.
   * Distinct from `unavailable` (a retryable blip): a retryable status here
   * would turn every fleet posting here into an unbounded retry loop.
   */
  | Readonly<{ outcome: "not-served"; errorMessage: string }>;

export type OtlpLogCollection = (input: {
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
  | Readonly<{ outcome: "unavailable"; errorMessage: string }>
  /** As {@link OtlpLogCollectionOutcome}'s own: permanent, not a blip. */
  | Readonly<{ outcome: "not-served"; errorMessage: string }>;

export type OtlpMetricCollection = (input: {
  tenantId: string;
  organizationId: string;
  metricRequest: unknown;
}) => Promise<OtlpMetricCollectionOutcome>;

/** Reports a failure the receiver answered but did not raise. */
export type OtlpIngestErrorReport = (
  error: Error,
  context: Readonly<{ projectId: string; customerTraceIds: string[] }>,
) => void;

/**
 * The whole of what the three OTLP routes ask the process for. NONE is
 * optional: the operations-only proxy throws a `TypeError` on any
 * unserved name, so stating all six here is a build failure, not a 500.
 */
export type OtlpIngestRestMembers = Readonly<{
  otlpCredential: OtlpIngestCredentialResolver;
  otlpUsageLimit: OtlpIngestUsageLimit;
  otlpTraces: OtlpTraceCollection;
  otlpLogs: OtlpLogCollection;
  otlpMetrics: OtlpMetricCollection;
  otlpReportError: OtlpIngestErrorReport;
}>;

export const OtlpIngestApi = moduleApi<OtlpIngestRestMembers>("trace");

const loggerTraces = createLogger("langwatch:otel:v1:traces");
const loggerLogs = createLogger("langwatch:otel:v1:logs");
const loggerMetrics = createLogger("langwatch:otel:v1:metrics");

const AUTH_REASON = "OTLP ingestion API key resolved in-handler";

/**
 * The generated protobuf message this receiver decodes into, for the
 * best-effort trace-id peek on a request that failed to parse.
 */
const traceRequestType =
  otlpProtobufRoot.opentelemetry.proto.collector.trace.v1.ExportTraceServiceRequest;

/**
 * A rejected OTLP body is unparsed, so it has not been through PII redaction.
 * Only its length may be recorded: the bytes carry prompts, completions and
 * host identifiers, and a log sink is not a place customer content may reach.
 */
function bodyForensics(body: ArrayBuffer | Uint8Array) {
  return { bodyBytes: body.byteLength };
}

/**
 * A misconfigured exporter fleet posts continuously with an identical
 * project/path signal, so a pair is reported at most once a window —
 * repetition costs money on an ingestion hot path for no new information.
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
 * produced. Logged here, not at the alias, since the project id is what
 * makes it actionable.
 */
function logCorrectedPath({
  request,
  path,
  projectId,
  logger,
}: {
  request: Request;
  path: string;
  projectId: string;
  logger: Logger;
}): void {
  const originalPath = readCorrectedPath(request.headers.get(OTLP_CORRECTED_PATH_HEADER) ?? undefined);
  if (!originalPath) return;
  // A NUL joins the pair because it cannot appear in a URL pathname, so no
  // project and path can collide with a different pair.
  const pair = [projectId, originalPath].join("\u0000");
  const isDueToLog = correctedPathIsDueToLog({ pair, now: nowInstant().epochMilliseconds });
  if (!isDueToLog) return;

  logger.warn(
    { projectId, originalPath, canonicalPath: path },
    "OTLP exporter posted to a non-canonical path; served from the canonical route",
  );
}

type OtlpAuthenticated =
  | Readonly<{
      project: { id: string; teamId: string; organizationId: string };
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
  request: Request,
  credential: OtlpIngestRestMembers["otlpCredential"],
  logger: Logger,
): Promise<OtlpAuthenticated> {
  const url = new URL(request.url);
  const diagnostics = collectAuthDiagnostics({
    path: url.pathname,
    method: request.method,
    header: (name: string) => request.headers.get(name) ?? undefined,
  });
  const resolution = await credential({ request });

  if (!resolution.ok) {
    logger.warn(
      { ...diagnostics, refusalStatus: resolution.status },
      diagnostics.hasEmptyAuthToken
        ? "Authentication failed: X-Auth-Token sent but empty"
        : "Authentication failed",
    );
    return { refusal: { status: resolution.status, body: resolution.body } };
  }

  logCorrectedPath({ request, path: url.pathname, projectId: resolution.project.id, logger });
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
 * array. Tags rejection logs so a customer's trace_id can be matched to it.
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
  return Array.from(collectDecodedTraceIds(request, max));
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

/**
 * Reconstructs a `Request` the shared `readOtlpBody` decompressor can
 * read: `.withRawBody("bytes")` already drained the framework's copy, so
 * this hands the SAME headers over a fresh body stream from bytes in hand.
 */
function requestForDecompression(request: Request, bytes: Uint8Array): Request {
  return new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body: bytes,
  });
}

const jsonAnswer = (body: unknown, status: ContentfulStatusCode): RestRawResult => ({
  status,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

/** The whole of one `POST /api/otel/v1/traces` request, inside its server span. */
async function handleTracesRequest(
  request: Request,
  span: Span,
  rawBytes: Uint8Array,
  ports: OtlpIngestRestMembers,
): Promise<RestRawResult> {
  // Auth runs before decompression, but the raw-body middleware has already
  // buffered the wire body — the declared body cap is what keeps a 401 cheap.
  const authenticated = await authenticate(request, ports.otlpCredential, loggerTraces);
  if ("refusal" in authenticated) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: "unauthenticated" });
    return jsonAnswer(authenticated.refusal.body, authenticated.refusal.status);
  }

  const { project, identity, markUsed } = authenticated;
  span.setAttribute("langwatch.project.id", project.id);

  const body = await readOtlpBody(requestForDecompression(request, rawBytes));
  const contentType = request.headers.get("content-type") ?? undefined;

  // ONE parse of the body, and the trace ids read off it. The rejection log
  // wants the customer's ids before the plan allowance is weighed; only the
  // failure branch, where there is no parsed request to read, parses again.
  const parsed = parseOtlpTraces(body, contentType);
  const customerTraceIds = parsed.ok
    ? Array.from(collectDecodedTraceIds(parsed.request, 10))
    : peekCustomerTraceIds(body, contentType);
  if (customerTraceIds.length > 0) {
    span.setAttribute("langwatch.otel.customer_trace_ids", customerTraceIds.join(","));
  }

  await ports.otlpUsageLimit({ project, customerTraceIds });

  if (body.byteLength === 0) {
    loggerTraces.debug({ projectId: project.id }, "Received empty trace request, ignoring");
    return jsonAnswer(
      { message: "No traces to process", partialSuccess: { rejectedSpans: 0, errorMessage: "" } },
      200,
    );
  }

  if (!parsed.ok) {
    loggerTraces.error(
      { error: parsed.error, projectId: project.id, customerTraceIds, ...bodyForensics(body) },
      "error parsing traces",
    );
    ports.otlpReportError(new Error(parsed.error), { projectId: project.id, customerTraceIds });
    span.setStatus({ code: SpanStatusCode.ERROR, message: "Failed to parse traces" });
    return jsonAnswer({ error: "Failed to parse traces" }, 400);
  }

  // Body successfully parsed - only now is the key marked used.
  markUsed();

  applyReceiverProvenance({ request: parsed.request, identity, signal: "traces", logger: loggerTraces });

  const result = await ports.otlpTraces({ tenantId: project.id, traceRequest: parsed.request });

  return jsonAnswer(
    {
      message: "Trace received successfully.",
      partialSuccess: {
        rejectedSpans: result?.rejectedSpans ?? 0,
        errorMessage: result?.errorMessage ?? "",
      },
    },
    200,
  );
}

/** The whole of one `POST /api/otel/v1/logs` request, inside its server span. */
async function handleLogsRequest(
  request: Request,
  span: Span,
  rawBytes: Uint8Array,
  ports: OtlpIngestRestMembers,
): Promise<RestRawResult> {
  const authenticated = await authenticate(request, ports.otlpCredential, loggerLogs);
  if ("refusal" in authenticated) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: "unauthenticated" });
    return jsonAnswer(authenticated.refusal.body, authenticated.refusal.status);
  }

  const { project, identity, markUsed } = authenticated;
  span.setAttribute("langwatch.project.id", project.id);

  await ports.otlpUsageLimit({ project, customerTraceIds: [] });

  const body = await readOtlpBody(requestForDecompression(request, rawBytes));
  const parsed = parseOtlpLogs(body, request.headers.get("content-type") ?? undefined);
  if (!parsed.ok) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: "Failed to parse logs" });
    span.recordException(new Error(parsed.error));
    loggerLogs.error(
      { error: parsed.error, projectId: project.id, ...bodyForensics(body) },
      "error parsing logs",
    );
    ports.otlpReportError(new Error(parsed.error), { projectId: project.id, customerTraceIds: [] });
    return jsonAnswer({ error: "Failed to parse logs" }, 400);
  }

  markUsed();

  applyReceiverProvenance({ request: parsed.request, identity, signal: "logs", logger: loggerLogs });

  const result = await ports.otlpLogs({
    tenantId: project.id,
    organizationId: project.organizationId,
    logRequest: parsed.request,
  });

  // Nothing was durably accepted and the cause is ours. OTLP treats a 200
  // with `partialSuccess` as a permanent rejection the client must not
  // re-send, so answering that here would turn a queue blip into fleet-wide
  // data loss. 503 is in OTLP's retryable set.
  if (result.outcome === "unavailable") {
    return jsonAnswer({ error: result.errorMessage }, 503);
  }

  // This deployment receives no logs at all, which is not a blip and will not
  // pass: 404, the same permanent refusal this address answers where the
  // family is not mounted, rather than a retryable status an exporter would
  // hammer forever for a batch that can never land.
  if (result.outcome === "not-served") {
    return jsonAnswer({ error: result.errorMessage }, 404);
  }

  return jsonAnswer(
    result.rejectedLogRecords > 0
      ? {
          partialSuccess: {
            rejectedLogRecords: result.rejectedLogRecords,
            ...(result.errorMessage ? { errorMessage: result.errorMessage } : {}),
          },
        }
      : {},
    200,
  );
}

/** The whole of one `POST /api/otel/v1/metrics` request, inside its server span. */
async function handleMetricsRequest(
  request: Request,
  span: Span,
  rawBytes: Uint8Array,
  ports: OtlpIngestRestMembers,
): Promise<RestRawResult> {
  const authenticated = await authenticate(request, ports.otlpCredential, loggerMetrics);
  if ("refusal" in authenticated) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: "unauthenticated" });
    return jsonAnswer(authenticated.refusal.body, authenticated.refusal.status);
  }

  const { project, identity, markUsed } = authenticated;
  span.setAttribute("langwatch.project.id", project.id);

  await ports.otlpUsageLimit({ project, customerTraceIds: [] });

  const body = await readOtlpBody(requestForDecompression(request, rawBytes));
  const parsed = parseOtlpMetrics(body, request.headers.get("content-type") ?? undefined);
  if (!parsed.ok) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: "Failed to parse metrics" });
    span.recordException(new Error(parsed.error));
    loggerMetrics.error(
      { error: parsed.error, projectId: project.id, ...bodyForensics(body) },
      "error parsing metrics",
    );
    ports.otlpReportError(new Error(parsed.error), {
      projectId: project.id,
      customerTraceIds: [],
    });
    return jsonAnswer({ error: "Failed to parse metrics" }, 400);
  }

  applyReceiverProvenance({ request: parsed.request, identity, signal: "metrics", logger: loggerMetrics });

  markUsed();

  const result = await ports.otlpMetrics({
    tenantId: project.id,
    organizationId: project.organizationId,
    metricRequest: parsed.request,
  });

  if (result.outcome === "unavailable") {
    return jsonAnswer({ error: result.errorMessage }, 503);
  }

  // As the logs signal: permanent, so not a retryable status. See there.
  if (result.outcome === "not-served") {
    return jsonAnswer({ error: result.errorMessage }, 404);
  }

  if (result.rejectedDataPoints === 0) return jsonAnswer({}, 200);
  return jsonAnswer(
    {
      partialSuccess: {
        rejectedDataPoints: result.rejectedDataPoints,
        ...(result.errorMessage ? { errorMessage: result.errorMessage } : {}),
      },
    },
    200,
  );
}

const PUBLIC_ACCESS = {
  kind: "public" as const,
  reason: AUTH_REASON,
};

/** The 413 a body past its cap earns, in the plain sentence it has always been. */
const payloadTooLarge = (): Error =>
  new HTTPException(413, { res: new Response("Payload Too Large", { status: 413 }) });

/** Wire-body cap for all three receivers; the decompressed cap is separate. */
const BODY_LIMIT_BULK_BYTES = resolveRequestBound("bodyLimitBulkBytes", "ENTERPRISE");

export const otlpIngestRest = defineRestRouter(OtlpIngestApi)
  .withNamespace("otel")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("v1-in-path")

  .post("/traces", "ingestOtlpTraces")
  .withRawBody("bytes")
  .withBodyLimit({ maxBytes: BODY_LIMIT_BULK_BYTES, onExceeded: payloadTooLarge })
  .withAccess(PUBLIC_ACCESS)
  .withRawResponse({ produces: "application/json" })
  .withDocs({ hide: true })
  .handle(async ({ app, raw, request }) => {
    const tracer = getLangWatchTracer("langwatch.otel.traces");

    return tracer.withActiveSpan("TracesV1.handleTracesRequest", { kind: SpanKind.SERVER }, (span) =>
      handleTracesRequest(request, span, raw as Uint8Array, app),
    );
  })

  .post("/logs", "ingestOtlpLogs")
  .withRawBody("bytes")
  .withBodyLimit({ maxBytes: BODY_LIMIT_BULK_BYTES, onExceeded: payloadTooLarge })
  .withAccess(PUBLIC_ACCESS)
  .withRawResponse({ produces: "application/json" })
  .withDocs({ hide: true })
  .handle(async ({ app, raw, request }) => {
    const tracer = getLangWatchTracer("langwatch.otel.logs");

    return tracer.withActiveSpan("[POST] /api/otel/v1/logs", { kind: SpanKind.SERVER }, (span) =>
      handleLogsRequest(request, span, raw as Uint8Array, app),
    );
  })

  .post("/metrics", "ingestOtlpMetrics")
  .withRawBody("bytes")
  .withBodyLimit({ maxBytes: BODY_LIMIT_BULK_BYTES, onExceeded: payloadTooLarge })
  .withAccess(PUBLIC_ACCESS)
  .withRawResponse({ produces: "application/json" })
  .withDocs({ hide: true })
  .handle(async ({ app, raw, request }) => {
    const tracer = getLangWatchTracer("langwatch.otel.metrics");

    return tracer.withActiveSpan("[POST] /api/otel/v1/metrics", { kind: SpanKind.SERVER }, (span) =>
      handleMetricsRequest(request, span, raw as Uint8Array, app),
    );
  })

  .build();
