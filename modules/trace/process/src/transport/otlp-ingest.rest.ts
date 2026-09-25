/**
 * The OTLP trace receiver: `POST /api/otel/v1/traces` and its aliases. Declared
 * public since it resolves its own credential via `app.otlpCredential`,
 * so a refusal answers with the credential chain's own status and body.
 */
import {
  collectAuthDiagnostics,
  defineRestRouter,
  MANAGEMENT_API_VERSION,
} from "@langwatch/api/rest";
import type { HandledError } from "@langwatch/handled-error";
import { createLogger, type Logger } from "@langwatch/observability";
import {
  applyReceiverProvenance,
  canonicalOtlpPath,
  decodeBase64OpenTelemetryId,
  ingestDoorRefusalBody,
  ingestDoorRefusalStatus,
  isIngestDoorRefusal,
  logCorrectedOtlpPath,
  OTLP_CORRECTED_PATH_HEADER,
  otlpBodyForensics,
  otlpProtobufRoot,
  parseOtlpTraces,
  readCorrectedPath,
  readOtlpBody,
  stampCorrectedPath,
} from "@langwatch/otlp";
import { resolveRequestBound } from "@langwatch/plans";
import {
  otlpTraceAliasParamsSchema,
  TraceApi,
  type OtlpIngestCredential,
  type OtlpIngestCredentialInput,
  type TraceOtlpIngestApi,
} from "@langwatch/trace-contract";
import { SpanKind, SpanStatusCode, type Span } from "@opentelemetry/api";
import type { IExportTraceServiceRequest } from "@opentelemetry/otlp-transformer";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { getLangWatchTracer } from "langwatch";

const loggerTraces = createLogger("langwatch:otel:v1:traces");

const AUTH_REASON = "OTLP ingestion API key resolved in-handler";

const PRODUCES_JSON = "application/json";

const OTLP_PROTOCOL_REASON =
  "OTLP/HTTP answers exporters in the protocol's own statuses and bodies, credential refusals included";

/**
 * The generated protobuf message this receiver decodes into, for the
 * best-effort trace-id peek on a request that failed to parse.
 */
const traceRequestType =
  otlpProtobufRoot.opentelemetry.proto.collector.trace.v1.ExportTraceServiceRequest;

type OtlpAuthenticated = OtlpIngestCredential | Readonly<{ refusal: HandledError }>;

/**
 * Resolves the credential and logs an auth-diagnostic fingerprint on every
 * failure path, so on-call can attribute a 401 to a specific customer and SDK
 * without asking them to reproduce it.
 */
async function authenticate(
  request: Request,
  credential: TraceOtlpIngestApi["otlpCredential"],
  logger: Logger,
): Promise<OtlpAuthenticated> {
  const url = new URL(request.url);
  const diagnostics = collectAuthDiagnostics({
    path: url.pathname,
    method: request.method,
    header: (name: string) => request.headers.get(name) ?? undefined,
  });
  const credentialInput: OtlpIngestCredentialInput = {
    authorization: request.headers.get("authorization"),
    xAuthToken: request.headers.get("x-auth-token"),
    xProjectId: request.headers.get("x-project-id"),
  };
  let resolution: OtlpIngestCredential;
  try {
    resolution = await credential(credentialInput);
  } catch (error) {
    if (!isIngestDoorRefusal(error)) throw error;

    logger.warn(
      { ...diagnostics, refusalStatus: ingestDoorRefusalStatus(error) },
      diagnostics.hasEmptyAuthToken
        ? "Authentication failed: X-Auth-Token sent but empty"
        : "Authentication failed",
    );
    return { refusal: error };
  }

  logCorrectedOtlpPath({
    originalPath: readCorrectedPath(request.headers.get(OTLP_CORRECTED_PATH_HEADER) ?? undefined),
    canonicalPath: url.pathname,
    projectId: resolution.project.id,
    logger,
  });
  return resolution;
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

/**
 * The older exporter bases resolve to a canonical signal without re-entering
 * the HTTP host. The marker is stamped in-process, so a customer header cannot
 * impersonate a corrected request in the receiver's diagnostic log.
 */
function deriveCorrectedOtlpRequest(request: Request): Request | null {
  const url = new URL(request.url);
  const originalPath = url.pathname;
  const canonicalPath = canonicalOtlpPath(originalPath);
  if (!canonicalPath || canonicalPath === originalPath) return null;

  url.pathname = canonicalPath;
  const headers = new Headers(request.headers);
  stampCorrectedPath({ headers, originalPath });

  return new Request(url, { method: request.method, headers });
}

/** One protocol answer: a JSON body at the status the receiver has always written. */
type OtlpAnswer = Readonly<{
  status: ContentfulStatusCode;
  mediaType: typeof PRODUCES_JSON;
  body: string;
}>;

const jsonAnswer = (body: unknown, status: ContentfulStatusCode): OtlpAnswer => ({
  status,
  mediaType: PRODUCES_JSON,
  body: JSON.stringify(body),
});

const refusalAnswer = (refusal: HandledError): OtlpAnswer =>
  jsonAnswer(ingestDoorRefusalBody(refusal), ingestDoorRefusalStatus(refusal));

/** The whole of one `POST /api/otel/v1/traces` request, inside its server span. */
async function handleTracesRequest({
  request,
  span,
  rawBytes,
  ports,
}: {
  request: Request;
  span: Span;
  rawBytes: Uint8Array;
  ports: TraceOtlpIngestApi;
}): Promise<OtlpAnswer> {
  // Auth runs before decompression, but the raw-body middleware has already
  // buffered the wire body — the declared body cap is what keeps a 401 cheap.
  const authenticated = await authenticate(request, ports.otlpCredential, loggerTraces);
  if ("refusal" in authenticated) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: "unauthenticated" });
    return refusalAnswer(authenticated.refusal);
  }

  const { project, identity } = authenticated;
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
      { error: parsed.error, projectId: project.id, customerTraceIds, ...otlpBodyForensics(body) },
      "error parsing traces",
    );
    ports.otlpReportError(new Error(parsed.error), { projectId: project.id, customerTraceIds });
    span.setStatus({ code: SpanStatusCode.ERROR, message: "Failed to parse traces" });
    return jsonAnswer({ error: "Failed to parse traces" }, 400);
  }

  // Body successfully parsed - only now is the key marked used.
  if (identity.apiKeyId) ports.otlpMarkCredentialUsed({ apiKeyId: identity.apiKeyId });

  applyReceiverProvenance({
    request: parsed.request,
    identity,
    signal: "traces",
    logger: loggerTraces,
  });

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

const PUBLIC_ACCESS = {
  kind: "public" as const,
  reason: AUTH_REASON,
};

/** The 413 a body past its cap earns, in the plain sentence it has always been. */
const payloadTooLarge = (): Error =>
  new HTTPException(413, { res: new Response("Payload Too Large", { status: 413 }) });

/** Wire-body cap; the decompressed cap is separate. */
const BODY_LIMIT_BULK_BYTES = resolveRequestBound("bodyLimitBulkBytes", "ENTERPRISE");

/** Serves a recognised misconfigured exporter URL from the canonical trace receiver. */
async function handleOtlpPathAlias({
  app,
  raw,
  request,
}: {
  app: TraceOtlpIngestApi;
  raw: Uint8Array;
  request: Request;
}): Promise<OtlpAnswer> {
  const corrected = deriveCorrectedOtlpRequest(request);
  if (!corrected) return jsonAnswer({ error: "Not Found" }, 404);

  switch (new URL(corrected.url).pathname) {
    case "/api/otel/v1/traces": {
      const tracer = getLangWatchTracer("langwatch.otel.traces");
      return tracer.withActiveSpan(
        "TracesV1.handleTracesRequest",
        { kind: SpanKind.SERVER },
        (span) => handleTracesRequest({ request: corrected, span, rawBytes: raw, ports: app }),
      );
    }
    default:
      return jsonAnswer({ error: "Not Found" }, 404);
  }
}

export const otlpIngestRest = defineRestRouter(TraceApi)
  .withNamespace("otel")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal", { v1Twin: false })

  .post("/api/otel/v1/traces", "ingestOtlpTraces")
  .withRawBody("bytes")
  .withBodyLimit({ maxBytes: BODY_LIMIT_BULK_BYTES, onExceeded: payloadTooLarge })
  .withAccess(PUBLIC_ACCESS)
  .withResponse("protocol", { produces: PRODUCES_JSON, because: OTLP_PROTOCOL_REASON })
  .withDocs({ hide: true })
  .handle(async ({ app, raw, request, response }) =>
    response.write(
      await getLangWatchTracer("langwatch.otel.traces").withActiveSpan(
        "TracesV1.handleTracesRequest",
        { kind: SpanKind.SERVER },
        (span) => handleTracesRequest({ request, span, rawBytes: raw, ports: app }),
      ),
    ),
  )

  // Exporters append `/v1/traces` to their configured base; each suffix is checked
  // against the allow-list in `canonicalOtlpPath` before it is served.
  .post("/:otlpBase{.+}/v1/traces", "ingestOtlpTracesAlias")
  .withParams(otlpTraceAliasParamsSchema)
  .withRawBody("bytes")
  .withBodyLimit({ maxBytes: BODY_LIMIT_BULK_BYTES, onExceeded: payloadTooLarge })
  .withAccess(PUBLIC_ACCESS)
  .withResponse("protocol", { produces: PRODUCES_JSON, because: OTLP_PROTOCOL_REASON })
  .withDocs({ hide: true })
  .handle(async ({ app, raw, request, response }) =>
    response.write(await handleOtlpPathAlias({ app, raw, request })),
  )

  .post("/:otlpBase{.+}/v1/traces/", "ingestOtlpTracesAliasSlash")
  .withParams(otlpTraceAliasParamsSchema)
  .withRawBody("bytes")
  .withBodyLimit({ maxBytes: BODY_LIMIT_BULK_BYTES, onExceeded: payloadTooLarge })
  .withAccess(PUBLIC_ACCESS)
  .withResponse("protocol", { produces: PRODUCES_JSON, because: OTLP_PROTOCOL_REASON })
  .withDocs({ hide: true })
  .handle(async ({ app, raw, request, response }) =>
    response.write(await handleOtlpPathAlias({ app, raw, request })),
  )

  .post("/v1/traces", "ingestOtlpTracesRootV1")
  .withRawBody("bytes")
  .withBodyLimit({ maxBytes: BODY_LIMIT_BULK_BYTES, onExceeded: payloadTooLarge })
  .withAccess(PUBLIC_ACCESS)
  .withResponse("protocol", { produces: PRODUCES_JSON, because: OTLP_PROTOCOL_REASON })
  .withDocs({ hide: true })
  .handle(async ({ app, raw, request, response }) =>
    response.write(await handleOtlpPathAlias({ app, raw, request })),
  )

  .post("/v1/traces/", "ingestOtlpTracesRootV1Slash")
  .withRawBody("bytes")
  .withBodyLimit({ maxBytes: BODY_LIMIT_BULK_BYTES, onExceeded: payloadTooLarge })
  .withAccess(PUBLIC_ACCESS)
  .withResponse("protocol", { produces: PRODUCES_JSON, because: OTLP_PROTOCOL_REASON })
  .withDocs({ hide: true })
  .handle(async ({ app, raw, request, response }) =>
    response.write(await handleOtlpPathAlias({ app, raw, request })),
  )

  .build();
