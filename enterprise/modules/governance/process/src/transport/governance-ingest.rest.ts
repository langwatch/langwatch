// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** Push-mode IngestionSource receivers under `/api/ingest`. */
import { publicRoute } from "@langwatch/api/access";
import { defineRestRouter, MANAGEMENT_API_VERSION } from "@langwatch/api/rest";
import {
  GovernanceRestApi,
  governanceIngestHeadersSchema,
  governanceIngestReceiptSchema,
  governanceIngestRefusalSchema,
  governanceIngestSourceParamsSchema,
} from "@langwatch/enterprise-governance-contract";

const ingestAnswers = {
  202: governanceIngestReceiptSchema,
  400: governanceIngestRefusalSchema,
  401: governanceIngestRefusalSchema,
  404: governanceIngestRefusalSchema,
  429: governanceIngestRefusalSchema,
  503: governanceIngestRefusalSchema,
} as const;

const INGEST_DOOR = publicRoute({
  reason:
    "an ingestion source's bearer secret is resolved in-handler against IngestionSource, and the receiver answers OTLP's own partial-success and refusal bodies",
});

export const governanceIngestRest = defineRestRouter(GovernanceRestApi)
  .withNamespace("ingest")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal", { v1Twin: true })

  .post("/api/ingest/otel/:sourceId", "ingestSourceOtlpTraces")
  .withParams(governanceIngestSourceParamsSchema)
  .withRawBody("bytes")
  .withAccess(INGEST_DOOR)
  .withHeaders(governanceIngestHeadersSchema)
  .responds(ingestAnswers)
  .withDocs({ hide: true })
  .handle(({ app, input, raw }, headers) =>
    app.ingestOtlpTraces({ sourceId: input.sourceId, raw, headers }),
  )

  .post("/api/ingest/webhook/:sourceId", "ingestSourceWebhook")
  .withParams(governanceIngestSourceParamsSchema)
  .withRawBody("text")
  .withAccess(INGEST_DOOR)
  .withHeaders(governanceIngestHeadersSchema)
  .responds(ingestAnswers)
  .withDocs({ hide: true })
  .handle(({ app, input, raw }, headers) =>
    app.ingestWebhook({ sourceId: input.sourceId, raw, headers }),
  )

  .post("/api/ingest/otel/:sourceId/v1/logs", "ingestSourceOtlpLogs")
  .withParams(governanceIngestSourceParamsSchema)
  .withRawBody("bytes")
  .withAccess(INGEST_DOOR)
  .withHeaders(governanceIngestHeadersSchema)
  .responds(ingestAnswers)
  .withDocs({ hide: true })
  .handle(({ app, input, raw }, headers) =>
    app.ingestOtlpLogs({ sourceId: input.sourceId, raw, headers }),
  )

  .post("/api/ingest/otel/:sourceId/v1/metrics", "ingestSourceOtlpMetrics")
  .withParams(governanceIngestSourceParamsSchema)
  .withRawBody("bytes")
  .withAccess(INGEST_DOOR)
  .withHeaders(governanceIngestHeadersSchema)
  .responds(ingestAnswers)
  .withDocs({ hide: true })
  .handle(({ app, input, raw }, headers) =>
    app.ingestOtlpMetrics({ sourceId: input.sourceId, raw, headers }),
  )

  .build();
