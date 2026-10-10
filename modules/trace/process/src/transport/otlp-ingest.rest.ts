/**
 * The OTLP trace receiver: `POST /api/otel/v1/traces`, which the host rewrites exporter aliases
 * onto, behind the OTLP ingest door. The door resolves the credential through
 * `app.otlpCredential` before the body is read; a refusal answers with the chain's own body.
 */
import { anyAuthenticated } from "@langwatch/api/access";
import {
  defineRestDoor,
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  type RestProtocolRefusal,
} from "@langwatch/api/rest";
import { createLogger } from "@langwatch/observability";
import {
  applyReceiverProvenance,
  decodeBase64OpenTelemetryId,
  ingestDoorRefusalBody,
  ingestDoorRefusalStatus,
  isIngestDoorRefusal,
  logCorrectedOtlpPath,
  OTLP_CORRECTED_PATH_HEADER,
  otlpBodyForensics,
  otlpDoorFailureAnswer,
  otlpProtobufRoot,
  parseOtlpTraces,
  readCorrectedPath,
  readOtlpBody,
  OTLP_REFUSED_MEDIA_TYPES,
} from "@langwatch/otlp";
import { resolveRequestBound } from "@langwatch/plans";
import {
  otlpIngestCredentialSchema,
  TraceApi,
  type OtlpIngestCredential,
  type TraceOtlpIngestApi,
} from "@langwatch/trace-contract";
import { SpanKind, type Span } from "@opentelemetry/api";
import type { IExportTraceServiceRequest } from "@opentelemetry/otlp-transformer";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { getLangWatchTracer } from "langwatch";

import { ingestPlanLimitRefusal } from "./collector.rest.ts";

const loggerTraces = createLogger("langwatch:otel:v1:traces");

const AUTH_REASON = "the OTLP ingest door's resolved key is the whole gate, as on main";

const PRODUCES_JSON = "application/json";

const OTLP_PROTOCOL_REASON =
  "OTLP/HTTP answers exporters in the protocol's own statuses and bodies, credential refusals included";

/**
 * The generated protobuf message this receiver decodes into, for the
 * best-effort trace-id peek on a request that failed to parse.
 */
const traceRequestType =
  otlpProtobufRoot.opentelemetry.proto.collector.trace.v1.ExportTraceServiceRequest;

/**
 * The OTLP ingest door over `otlpCredential`. It logs an auth-diagnostic fingerprint on every
 * refusal, so on-call can attribute a 401 to a specific customer and SDK without asking them to
 * reproduce it.
 */
export const otlpIngestDoor = defineRestDoor("otlp_ingest", {
  needs: TraceApi,
  identify: async ({ authorization, xAuthToken, xProjectId, diagnostics }, traces) => {
    try {
      const resolution = await traces.otlpCredential({ authorization, xAuthToken, xProjectId });
      const { apiKeyId } = resolution.identity;
      const actor = apiKeyId ? { type: "api_key" as const, id: apiKeyId } : null;

      return { actor, scope: { tier: "project", id: resolution.project.id }, session: resolution };
    } catch (error) {
      if (!isIngestDoorRefusal(error)) throw error;

      loggerTraces.warn(
        { ...diagnostics, refusalStatus: ingestDoorRefusalStatus(error) },
        diagnostics.hasEmptyAuthToken
          ? "Authentication failed: X-Auth-Token sent but empty"
          : "Authentication failed",
      );
      throw error;
    }
  },
});

/**
 * Best-effort extraction of customer trace_ids from an OTLP traces body.
 * Never throws — an empty, malformed or unparsable body yields an empty
 * array. Tags rejection logs so a customer's trace_id can be matched to it.
 */
function peekCustomerTraceIds(
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
    // A copy: a fetch body must be backed by a plain ArrayBuffer, which a view may not be.
    body: new Uint8Array(bytes),
  });
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

/** The door's credential refusals and the plan limit, each in the receiver's own body. */
const otlpIngestRefusal: RestProtocolRefusal = ({ failure, response }) =>
  isIngestDoorRefusal(failure)
    ? response.write(jsonAnswer(ingestDoorRefusalBody(failure), ingestDoorRefusalStatus(failure)))
    : ingestPlanLimitRefusal({ failure, response });

/** The whole of one `POST /api/otel/v1/traces` request, inside its server span. */
async function handleTracesRequest({
  request,
  span,
  rawBytes,
  ports,
  credential,
}: {
  request: Request;
  span: Span;
  rawBytes: Uint8Array;
  ports: TraceOtlpIngestApi;
  credential: OtlpIngestCredential;
}): Promise<OtlpAnswer> {
  const { project, identity } = credential;
  logCorrectedOtlpPath({
    originalPath: readCorrectedPath(request.headers.get(OTLP_CORRECTED_PATH_HEADER) ?? undefined),
    canonicalPath: new URL(request.url).pathname,
    projectId: project.id,
    logger: loggerTraces,
  });
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
    // The client's fault (specs/otlp/client-parse-failures.feature): warn, no
    // exception, span status left UNSET as for any customer fault (policy.ts).
    span.setAttributes({
      "langwatch.error.fault": "customer",
      "langwatch.otel.parse_error": parsed.error,
    });
    loggerTraces.warn(
      {
        handledErrorFault: "customer",
        error: parsed.error,
        projectId: project.id,
        customerTraceIds,
        ...otlpBodyForensics(body),
      },
      "error parsing traces",
    );
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

  // Any failed handoff answers 503 so the sender resends the whole batch: taken
  // spans dedupe (claim held an hour), failed ones had their claim released.
  if ((result?.ingestionFailures ?? 0) > 0) {
    const failure = otlpDoorFailureAnswer({
      result: { outcome: "unavailable", errorMessage: result.ingestionFailureMessage ?? "" },
      signal: "traces",
    });
    return jsonAnswer(failure.body, failure.status);
  }

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

const INGEST_ACCESS = anyAuthenticated({ reason: AUTH_REASON });

/** Wire-body cap; the decompressed cap is separate. */
const BODY_LIMIT_BULK_BYTES = resolveRequestBound("bodyLimitBulkBytes", "ENTERPRISE");

export const otlpIngestRest = defineRestRouter(TraceApi)
  .withNamespace("otel")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal", { v1Twin: false })
  .withCredential("otlp_ingest")

  .post("/api/otel/v1/traces", "ingestOtlpTraces")
  .withoutAudit("ingestion")
  .withCredential("otlp_ingest", { session: otlpIngestCredentialSchema })
  .withRawBody("bytes", { refuses: OTLP_REFUSED_MEDIA_TYPES })
  .withBodyLimit({ maxBytes: BODY_LIMIT_BULK_BYTES })
  .withAccess(INGEST_ACCESS)
  .withResponse("protocol", {
    produces: PRODUCES_JSON,
    because: OTLP_PROTOCOL_REASON,
    refusal: otlpIngestRefusal,
  })
  .withDocs({ hide: true })
  .handle(async ({ app, raw, request, response, session }) =>
    response.write(
      await getLangWatchTracer("langwatch.otel.traces").withActiveSpan(
        "TracesV1.handleTracesRequest",
        { kind: SpanKind.SERVER },
        (span) =>
          handleTracesRequest({ request, span, rawBytes: raw, ports: app, credential: session }),
      ),
    ),
  )

  .build();
