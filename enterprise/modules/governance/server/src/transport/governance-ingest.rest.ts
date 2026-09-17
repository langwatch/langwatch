// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Push-mode IngestionSource receivers for the Activity Monitor: OTLP/HTTP
 * passthrough, a generic JSON webhook, and OTLP's own `/v1/logs` and
 * `/v1/metrics` sub-paths, all under `/api/ingest/{otel,webhook}/:sourceId`.
 * @see specs/ai-gateway/governance/
 */
import { publicRoute } from "@langwatch/api/access";
import { defineRestRouter, MANAGEMENT_API_VERSION, type RestRawResult } from "@langwatch/api/rest";
import { governanceIngestSourceParamsSchema } from "@langwatch/enterprise-governance-contract";
import { readOtlpBody } from "@langwatch/otlp";
import { moduleApi } from "@langwatch/kernel";

import type {
  GovernanceIngestAccessApi,
  GovernanceIngestAuthorization,
} from "../services/governance-ingest-access.service.ts";
import type { GovernanceIngestReceiverApi } from "../services/governance-ingest-receiver.service.ts";

/**
 * What the receivers call. Declared here rather than in the contract because
 * the services behind it read this feature server's own repositories, which a
 * contract package may not name.
 *
 * NEITHER is optional: a signal this deployment folds nowhere answers
 * `not-served`, so an exporter gets a permanent 404 from a receiver that
 * honestly does not serve it rather than a 500 from one that pretends to.
 */
export type GovernanceIngestRestApi = Readonly<{
  /** Throttle, bearer secret and path-id check, in that order. */
  ingestAccess: () => GovernanceIngestAccessApi;
  /** Where a payload of each signal is folded, priced and acknowledged. */
  ingestReceiver: () => GovernanceIngestReceiverApi;
}>;

export const GovernanceIngestRestApi = moduleApi<GovernanceIngestRestApi>()("governance");

const JSON_MEDIA_TYPE = "application/json";

/**
 * The bearer is a per-source ingest secret resolved by hash lookup with the
 * rotated-secret grace window, not an RBAC credential, and every answer is the
 * receiver's own: OTLP's partial-success document, the
 * `{ error, error_description }` refusals and the 429 carrying `Retry-After`.
 */
const INGEST_DOOR = publicRoute({
  reason:
    "an ingestion source's bearer secret is resolved in-handler against IngestionSource, and the receiver answers OTLP's own partial-success and refusal bodies",
});

/** A JSON body this family writes itself, exactly as its exporters read it. */
function answer(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": JSON_MEDIA_TYPE, ...headers },
  });
}

/**
 * The refusal the gate answers, in the bodies this family has always used: a
 * bare `unauthorized` that never confirms some other source id exists, and a
 * throttle that names its own window.
 */
function refuseGate(
  gate: Exclude<GovernanceIngestAuthorization, { outcome: "authorized" }>,
): Response {
  if (gate.outcome === "rate-limited") {
    return answer(
      {
        error: "rate_limited",
        error_description:
          "Too many requests from this client. Slow down and retry after the Retry-After window.",
      },
      429,
      { "Retry-After": String(gate.retryAfterSec) },
    );
  }

  return answer({ error: "unauthorized" }, 401);
}

/**
 * The permanent refusal a signal this deployment folds nowhere earns. 404, not
 * a retryable status: a batch that can never land would otherwise be hammered
 * by every exporter in the fleet forever.
 */
const notServed = (signal: string): Response =>
  answer(
    {
      error: "not_served",
      error_description: `This deployment does not receive ${signal} on an ingestion source.`,
    },
    404,
  );

const wrongEndpoint = (description: string): Response =>
  answer({ error: "wrong_endpoint", error_description: description }, 400);

/**
 * Reconstructs a `Request` the shared `readOtlpBody` decompressor can read:
 * `.withRawBody("bytes")` already drained the framework's copy, so this hands
 * the SAME headers over a fresh body stream from bytes in hand.
 */
function requestForDecompression(request: Request, bytes: Uint8Array): Request {
  return new Request(request.url, {
    method: request.method,
    headers: request.headers,
    // `slice()` re-homes the view on an ArrayBuffer of its own, which is the
    // only buffer kind a request body may be built over.
    body: bytes.slice(),
  });
}

/**
 * `/api/ingest`, at exactly the addresses an exporter is configured with: an
 * admin pastes `{base}/api/ingest/otel/{sourceId}` and the exporter appends
 * OTLP's own suffix, so the path is the contract rather than a dated namespace.
 */
export const governanceIngestRest = defineRestRouter(GovernanceIngestRestApi)
  .withNamespace("ingest")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal", { v1Twin: true })

  /**
   * OTLP/HTTP passthrough for span-shaped sources: origin metadata stamped on
   * every span, then the existing trace pipeline under the organization's
   * hidden governance project. The receiver never writes storage directly.
   */
  .post("/api/ingest/otel/:sourceId", "ingestSourceOtlpTraces")
  .withParams(governanceIngestSourceParamsSchema)
  .withRawBody("bytes")
  .withAccess(INGEST_DOOR)
  .withRawResponse({ produces: JSON_MEDIA_TYPE })
  .withDocs({ hide: true })
  .handle(async ({ app, input, raw, request }): Promise<RestRawResult> => {
    const gate = await app
      .ingestAccess()
      .authorize({ headers: request.headers, sourceId: input.sourceId });

    if (gate.outcome !== "authorized") return refuseGate(gate);

    const receipt = await app.ingestReceiver().receiveTraces({
      source: gate.source,
      contentType: request.headers.get("content-type") ?? void 0,
      read: () => readOtlpBody(requestForDecompression(request, raw)),
    });

    if (receipt.outcome === "wrong-endpoint") {
      return wrongEndpoint(
        "OTLP path is only valid for otel_generic, claude_cowork, and claude_code sources",
      );
    }

    const body: Record<string, unknown> = {
      accepted: true,
      bytes: receipt.bytes,
      events: receipt.events,
    };

    if (receipt.rejectedSpans > 0) body.rejectedSpans = receipt.rejectedSpans;

    if (receipt.events === 0 && (receipt.hint || receipt.bytes > 0)) {
      body.hint = receipt.hint
        ? `Body did not parse as OTLP/HTTP: ${receipt.hint}. See https://docs.langwatch.ai/observability/trace-vs-activity-ingestion for the canonical shape.`
        : "Body received but no spans extracted. OTLP/HTTP expects " +
          "resource_spans[].scope_spans[].spans[] with non-empty spans " +
          "arrays. See https://docs.langwatch.ai/ai-gateway/governance/" +
          "ingestion-sources/otel-generic for a copy-paste curl.";
    }

    return answer(body, 202);
  })

  /**
   * Generic JSON webhook for flat-event sources, mapped to ONE OTLP log record
   * and handed to the existing log pipeline: same store, same drill-down, with
   * origin metadata separating it from application logs.
   */
  .post("/api/ingest/webhook/:sourceId", "ingestSourceWebhook")
  .withParams(governanceIngestSourceParamsSchema)
  .withRawBody("text")
  .withAccess(INGEST_DOOR)
  .withRawResponse({ produces: JSON_MEDIA_TYPE })
  .withDocs({ hide: true })
  .handle(async ({ app, input, raw, request }): Promise<RestRawResult> => {
    const gate = await app
      .ingestAccess()
      .authorize({ headers: request.headers, sourceId: input.sourceId });

    if (gate.outcome !== "authorized") return refuseGate(gate);

    const receipt = await app.ingestReceiver().receiveWebhook({ source: gate.source, body: raw });

    if (receipt.outcome === "not-served") return notServed("webhook events");

    if (receipt.outcome === "wrong-endpoint") {
      return wrongEndpoint(
        "Webhook path is only valid for workato, otel_generic, and s3_custom (callback-mode) sources",
      );
    }

    return answer({ accepted: true, bytes: receipt.bytes, eventId: receipt.eventId }, 202);
  })

  /**
   * Per-request events on OTLP's standard sub-path. The records reach the log
   * pipeline for forensics, and the cost events inside them are priced into
   * the ledger so budgets and anomaly rules fire on third-party traffic.
   */
  .post("/api/ingest/otel/:sourceId/v1/logs", "ingestSourceOtlpLogs")
  .withParams(governanceIngestSourceParamsSchema)
  .withRawBody("bytes")
  .withAccess(INGEST_DOOR)
  .withRawResponse({ produces: JSON_MEDIA_TYPE })
  .withDocs({ hide: true })
  .handle(async ({ app, input, raw, request }): Promise<RestRawResult> => {
    const gate = await app
      .ingestAccess()
      .authorize({ headers: request.headers, sourceId: input.sourceId });

    if (gate.outcome !== "authorized") return refuseGate(gate);

    const receipt = await app.ingestReceiver().receiveLogs({
      source: gate.source,
      contentType: request.headers.get("content-type") ?? void 0,
      read: () => readOtlpBody(requestForDecompression(request, raw)),
    });

    if (receipt.outcome === "not-served") return notServed("OTLP logs");

    const body: Record<string, unknown> = {
      accepted: true,
      bytes: receipt.bytes,
      logRecords: receipt.logRecords,
      costEvents: receipt.costEvents,
      ledgerRows: receipt.ledgerRows,
    };

    if (receipt.hint) body.hint = receipt.hint;

    return answer(body, 202);
  })

  /**
   * The one receiver that does not acknowledge every failure: a throw AFTER
   * the parse is ours rather than the sender's, so it answers 503 and records
   * no source event — the collector's retry must not double-count.
   */
  .post("/api/ingest/otel/:sourceId/v1/metrics", "ingestSourceOtlpMetrics")
  .withParams(governanceIngestSourceParamsSchema)
  .withRawBody("bytes")
  .withAccess(INGEST_DOOR)
  .withRawResponse({ produces: JSON_MEDIA_TYPE })
  .withDocs({ hide: true })
  .handle(async ({ app, input, raw, request }): Promise<RestRawResult> => {
    const gate = await app
      .ingestAccess()
      .authorize({ headers: request.headers, sourceId: input.sourceId });

    if (gate.outcome !== "authorized") return refuseGate(gate);

    const receipt = await app.ingestReceiver().receiveMetrics({
      source: gate.source,
      contentType: request.headers.get("content-type") ?? void 0,
      read: () => readOtlpBody(requestForDecompression(request, raw)),
    });

    if (receipt.outcome === "not-served") return notServed("OTLP metrics");

    if (receipt.outcome === "unavailable") {
      return answer({ accepted: false, error: receipt.errorMessage }, 503);
    }

    if (receipt.outcome === "error") {
      return answer({ accepted: false, error: "failed to record data point" }, 503);
    }

    const body: Record<string, unknown> = {
      accepted: true,
      bytes: receipt.bytes,
      metrics: receipt.metrics,
      acceptedDataPoints: receipt.acceptedDataPoints,
      partialSuccess: {
        rejectedDataPoints: receipt.rejectedDataPoints,
        ...(receipt.hint ? { errorMessage: receipt.hint } : {}),
      },
    };

    if (receipt.hint) body.hint = receipt.hint;

    return answer(body, 202);
  })

  .build();
