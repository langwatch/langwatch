import { publicRoute } from "@langwatch/api/access";
import { defineRestRouter, MANAGEMENT_API_VERSION } from "@langwatch/api/rest";
import {
  GovernanceRestApi,
  governanceIngestHeadersSchema,
  governanceIngestReceiptSchema,
  governanceIngestSourceParamsSchema,
} from "@langwatch/enterprise-governance-contract";
// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** Push-mode IngestionSource receivers under `/api/ingest`. */
import { OTLP_REFUSED_MEDIA_TYPES } from "@langwatch/otlp";
import { resolveRequestBound } from "@langwatch/plans";

/** The acknowledgement; every refusal is a thrown HandledError the runtime renders. */
const ingestAnswers = { 202: governanceIngestReceiptSchema } as const;

/** Wire-body caps, refused before the source is resolved; the decompressed cap is separate. */
const BODY_LIMIT_BULK_BYTES = resolveRequestBound("bodyLimitBulkBytes", "ENTERPRISE");
/** A webhook envelope lands as one log record, so it takes the JSON route cap. */
const BODY_LIMIT_JSON_BYTES = resolveRequestBound("bodyLimitJsonBytes", "ENTERPRISE");

const INGEST_DOOR = publicRoute({
  reason:
    "an ingestion source's bearer secret is resolved in-handler against IngestionSource, and the receiver answers OTLP's own partial-success body",
});

export const governanceIngestRest = defineRestRouter(GovernanceRestApi)
  .withNamespace("ingest")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal", { v1Twin: true })

  .post("/api/ingest/otel/:sourceId", "ingestSourceOtlpTraces")
  .servesWhileUpgrading()
  .withParams(governanceIngestSourceParamsSchema)
  .withRawBody("bytes", { refuses: OTLP_REFUSED_MEDIA_TYPES })
  .withBodyLimit({ maxBytes: BODY_LIMIT_BULK_BYTES })
  .withAccess(INGEST_DOOR)
  .withHeaders(governanceIngestHeadersSchema)
  .responds(ingestAnswers)
  .withDocs({ hide: true })
  .handle(({ app, input, raw }, headers) =>
    app.ingestOtlpTraces({ sourceId: input.sourceId, raw, headers }),
  )

  .post("/api/ingest/webhook/:sourceId", "ingestSourceWebhook")
  .servesWhileUpgrading()
  .withParams(governanceIngestSourceParamsSchema)
  .withRawBody("text")
  .withBodyLimit({ maxBytes: BODY_LIMIT_JSON_BYTES })
  .withAccess(INGEST_DOOR)
  .withHeaders(governanceIngestHeadersSchema)
  .responds(ingestAnswers)
  .withDocs({ hide: true })
  .handle(({ app, input, raw }, headers) =>
    app.ingestWebhook({ sourceId: input.sourceId, raw, headers }),
  )

  .post("/api/ingest/otel/:sourceId/v1/logs", "ingestSourceOtlpLogs")
  .servesWhileUpgrading()
  .withParams(governanceIngestSourceParamsSchema)
  .withRawBody("bytes", { refuses: OTLP_REFUSED_MEDIA_TYPES })
  .withBodyLimit({ maxBytes: BODY_LIMIT_BULK_BYTES })
  .withAccess(INGEST_DOOR)
  .withHeaders(governanceIngestHeadersSchema)
  .responds(ingestAnswers)
  .withDocs({ hide: true })
  .handle(({ app, input, raw }, headers) =>
    app.ingestOtlpLogs({ sourceId: input.sourceId, raw, headers }),
  )

  .post("/api/ingest/otel/:sourceId/v1/metrics", "ingestSourceOtlpMetrics")
  .servesWhileUpgrading()
  .withParams(governanceIngestSourceParamsSchema)
  .withRawBody("bytes", { refuses: OTLP_REFUSED_MEDIA_TYPES })
  .withBodyLimit({ maxBytes: BODY_LIMIT_BULK_BYTES })
  .withAccess(INGEST_DOOR)
  .withHeaders(governanceIngestHeadersSchema)
  .responds(ingestAnswers)
  .withDocs({ hide: true })
  .handle(({ app, input, raw }, headers) =>
    app.ingestOtlpMetrics({ sourceId: input.sourceId, raw, headers }),
  )

  .build();
