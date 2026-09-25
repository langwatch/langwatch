/**
 * The OTLP metrics receiver: `POST /api/otel/v1/metrics` and the misconfigured
 * exporter bases main serves it under (otel-path-aliases.ts). Public: the
 * receiver resolves its own key through Trace, and answers in OTLP's wire.
 */
import { defineRestRouter, MANAGEMENT_API_VERSION } from "@langwatch/api/rest";
import { MetricApi, otlpMetricAliasParamsSchema } from "@langwatch/metric-contract";
import { resolveRequestBound } from "@langwatch/plans";
import { HTTPException } from "hono/http-exception";

import { otlpMetricAnswer } from "../rules/otlp-metric-answer.rules.ts";

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

export const otlpMetricsRest = defineRestRouter(MetricApi)
  .withNamespace("otel-metrics")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal", { v1Twin: false })

  .post("/api/otel/v1/metrics", "ingestOtlpMetrics")
  .withRawBody("bytes")
  .withBodyLimit({ maxBytes: BODY_LIMIT_BULK_BYTES, onExceeded: payloadTooLarge })
  .withAccess(PUBLIC_ACCESS)
  .withResponse("protocol", { produces: PRODUCES_JSON, because: OTLP_PROTOCOL_REASON })
  .withDocs({ hide: true })
  .handle(async ({ app, raw, request, response }) => {
    const { status, body } = otlpMetricAnswer(
      await app.receiveOtlpMetrics({
        method: request.method,
        path: new URL(request.url).pathname,
        headers: Object.fromEntries(request.headers),
        body: raw,
      }),
    );
    return response.write({ status, mediaType: PRODUCES_JSON, body: JSON.stringify(body) });
  })

  // Exporters append `/v1/metrics` to their configured base; the receiver serves
  // only the bases `canonicalOtlpPath` allows, and answers 404 to the rest.
  .post("/:otlpBase{.+}/v1/metrics", "ingestOtlpMetricsAlias")
  .withParams(otlpMetricAliasParamsSchema)
  .withRawBody("bytes")
  .withBodyLimit({ maxBytes: BODY_LIMIT_BULK_BYTES, onExceeded: payloadTooLarge })
  .withAccess(PUBLIC_ACCESS)
  .withResponse("protocol", { produces: PRODUCES_JSON, because: OTLP_PROTOCOL_REASON })
  .withDocs({ hide: true })
  .handle(async ({ app, raw, request, response }) => {
    const { status, body } = otlpMetricAnswer(
      await app.receiveOtlpMetrics({
        method: request.method,
        path: new URL(request.url).pathname,
        headers: Object.fromEntries(request.headers),
        body: raw,
      }),
    );
    return response.write({ status, mediaType: PRODUCES_JSON, body: JSON.stringify(body) });
  })

  .post("/:otlpBase{.+}/v1/metrics/", "ingestOtlpMetricsAliasSlash")
  .withParams(otlpMetricAliasParamsSchema)
  .withRawBody("bytes")
  .withBodyLimit({ maxBytes: BODY_LIMIT_BULK_BYTES, onExceeded: payloadTooLarge })
  .withAccess(PUBLIC_ACCESS)
  .withResponse("protocol", { produces: PRODUCES_JSON, because: OTLP_PROTOCOL_REASON })
  .withDocs({ hide: true })
  .handle(async ({ app, raw, request, response }) => {
    const { status, body } = otlpMetricAnswer(
      await app.receiveOtlpMetrics({
        method: request.method,
        path: new URL(request.url).pathname,
        headers: Object.fromEntries(request.headers),
        body: raw,
      }),
    );
    return response.write({ status, mediaType: PRODUCES_JSON, body: JSON.stringify(body) });
  })

  .post("/v1/metrics", "ingestOtlpMetricsRootV1")
  .withRawBody("bytes")
  .withBodyLimit({ maxBytes: BODY_LIMIT_BULK_BYTES, onExceeded: payloadTooLarge })
  .withAccess(PUBLIC_ACCESS)
  .withResponse("protocol", { produces: PRODUCES_JSON, because: OTLP_PROTOCOL_REASON })
  .withDocs({ hide: true })
  .handle(async ({ app, raw, request, response }) => {
    const { status, body } = otlpMetricAnswer(
      await app.receiveOtlpMetrics({
        method: request.method,
        path: new URL(request.url).pathname,
        headers: Object.fromEntries(request.headers),
        body: raw,
      }),
    );
    return response.write({ status, mediaType: PRODUCES_JSON, body: JSON.stringify(body) });
  })

  .post("/v1/metrics/", "ingestOtlpMetricsRootV1Slash")
  .withRawBody("bytes")
  .withBodyLimit({ maxBytes: BODY_LIMIT_BULK_BYTES, onExceeded: payloadTooLarge })
  .withAccess(PUBLIC_ACCESS)
  .withResponse("protocol", { produces: PRODUCES_JSON, because: OTLP_PROTOCOL_REASON })
  .withDocs({ hide: true })
  .handle(async ({ app, raw, request, response }) => {
    const { status, body } = otlpMetricAnswer(
      await app.receiveOtlpMetrics({
        method: request.method,
        path: new URL(request.url).pathname,
        headers: Object.fromEntries(request.headers),
        body: raw,
      }),
    );
    return response.write({ status, mediaType: PRODUCES_JSON, body: JSON.stringify(body) });
  })

  .build();
