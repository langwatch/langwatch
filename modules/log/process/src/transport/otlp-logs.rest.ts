/**
 * The OTLP logs receiver: `POST /api/otel/v1/logs` and the misconfigured
 * exporter bases main serves it under (otel-path-aliases.ts). Public: the
 * receiver resolves its own key through Trace, and answers in OTLP's wire.
 */
import { defineRestRouter, MANAGEMENT_API_VERSION } from "@langwatch/api/rest";
import { LogApi, otlpLogAliasParamsSchema } from "@langwatch/log-contract";
import { resolveRequestBound } from "@langwatch/plans";
import { HTTPException } from "hono/http-exception";

import { otlpLogAnswer } from "../rules/otlp-log-answer.rules.ts";

const PRODUCES_JSON = "application/json";

const OTLP_PROTOCOL_REASON =
  "OTLP/HTTP answers exporters in the protocol's own statuses and bodies, credential refusals included";

const PUBLIC_ACCESS = {
  kind: "public" as const,
  reason: "OTLP ingestion API key resolved in-handler",
};

/** The 413 a body past its cap earns, in the plain sentence it has always been. */
const payloadTooLarge = (): Error =>
  new HTTPException(413, { res: new Response("Payload Too Large", { status: 413 }) });

/** Wire-body cap; the decompressed cap is separate. */
const BODY_LIMIT_BULK_BYTES = resolveRequestBound("bodyLimitBulkBytes", "ENTERPRISE");

export const otlpLogsRest = defineRestRouter(LogApi)
  .withNamespace("otel-logs")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal", { v1Twin: false })

  .post("/api/otel/v1/logs", "ingestOtlpLogs")
  .withRawBody("bytes")
  .withBodyLimit({ maxBytes: BODY_LIMIT_BULK_BYTES, onExceeded: payloadTooLarge })
  .withAccess(PUBLIC_ACCESS)
  .withResponse("protocol", { produces: PRODUCES_JSON, because: OTLP_PROTOCOL_REASON })
  .withDocs({ hide: true })
  .handle(async ({ app, raw, request, response }) => {
    const { status, body } = otlpLogAnswer(
      await app.receiveOtlpLogs({
        method: request.method,
        path: new URL(request.url).pathname,
        headers: Object.fromEntries(request.headers),
        body: raw,
      }),
    );
    return response.write({ status, mediaType: PRODUCES_JSON, body: JSON.stringify(body) });
  })

  // Exporters append `/v1/logs` to their configured base; the receiver serves
  // only the bases `canonicalOtlpPath` allows, and answers 404 to the rest.
  .post("/:otlpBase{.+}/v1/logs", "ingestOtlpLogsAlias")
  .withParams(otlpLogAliasParamsSchema)
  .withRawBody("bytes")
  .withBodyLimit({ maxBytes: BODY_LIMIT_BULK_BYTES, onExceeded: payloadTooLarge })
  .withAccess(PUBLIC_ACCESS)
  .withResponse("protocol", { produces: PRODUCES_JSON, because: OTLP_PROTOCOL_REASON })
  .withDocs({ hide: true })
  .handle(async ({ app, raw, request, response }) => {
    const { status, body } = otlpLogAnswer(
      await app.receiveOtlpLogs({
        method: request.method,
        path: new URL(request.url).pathname,
        headers: Object.fromEntries(request.headers),
        body: raw,
      }),
    );
    return response.write({ status, mediaType: PRODUCES_JSON, body: JSON.stringify(body) });
  })

  .post("/:otlpBase{.+}/v1/logs/", "ingestOtlpLogsAliasSlash")
  .withParams(otlpLogAliasParamsSchema)
  .withRawBody("bytes")
  .withBodyLimit({ maxBytes: BODY_LIMIT_BULK_BYTES, onExceeded: payloadTooLarge })
  .withAccess(PUBLIC_ACCESS)
  .withResponse("protocol", { produces: PRODUCES_JSON, because: OTLP_PROTOCOL_REASON })
  .withDocs({ hide: true })
  .handle(async ({ app, raw, request, response }) => {
    const { status, body } = otlpLogAnswer(
      await app.receiveOtlpLogs({
        method: request.method,
        path: new URL(request.url).pathname,
        headers: Object.fromEntries(request.headers),
        body: raw,
      }),
    );
    return response.write({ status, mediaType: PRODUCES_JSON, body: JSON.stringify(body) });
  })

  .post("/v1/logs", "ingestOtlpLogsRootV1")
  .withRawBody("bytes")
  .withBodyLimit({ maxBytes: BODY_LIMIT_BULK_BYTES, onExceeded: payloadTooLarge })
  .withAccess(PUBLIC_ACCESS)
  .withResponse("protocol", { produces: PRODUCES_JSON, because: OTLP_PROTOCOL_REASON })
  .withDocs({ hide: true })
  .handle(async ({ app, raw, request, response }) => {
    const { status, body } = otlpLogAnswer(
      await app.receiveOtlpLogs({
        method: request.method,
        path: new URL(request.url).pathname,
        headers: Object.fromEntries(request.headers),
        body: raw,
      }),
    );
    return response.write({ status, mediaType: PRODUCES_JSON, body: JSON.stringify(body) });
  })

  .post("/v1/logs/", "ingestOtlpLogsRootV1Slash")
  .withRawBody("bytes")
  .withBodyLimit({ maxBytes: BODY_LIMIT_BULK_BYTES, onExceeded: payloadTooLarge })
  .withAccess(PUBLIC_ACCESS)
  .withResponse("protocol", { produces: PRODUCES_JSON, because: OTLP_PROTOCOL_REASON })
  .withDocs({ hide: true })
  .handle(async ({ app, raw, request, response }) => {
    const { status, body } = otlpLogAnswer(
      await app.receiveOtlpLogs({
        method: request.method,
        path: new URL(request.url).pathname,
        headers: Object.fromEntries(request.headers),
        body: raw,
      }),
    );
    return response.write({ status, mediaType: PRODUCES_JSON, body: JSON.stringify(body) });
  })

  .build();
