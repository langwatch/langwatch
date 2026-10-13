/**
 * Trace folds governance's coding-assistant billing fact from its own side (§9; Q82, Alex
 * 2026-10-06), so trace holds no governance peer and reads its own row at OTLP ingest.
 * Spec: specs/server/otlp-receiver-policy.feature
 */
import {
  CODING_ASSISTANT_BILLING_EVENT_TYPES,
  codingAssistantBillingRecordedEventDataSchema,
} from "@langwatch/enterprise-governance-contract";
import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";

import type { TraceModule } from "../../../app/trace.app.ts";
import type { TraceIngestSourceBillingService } from "../services/trace-ingest-source-billing.service.ts";

const TRACE_INGEST_SOURCE_BILLING_PIPELINE_NAME = "trace_ingest_source_billing" as const;

export type TraceIngestSourceBillingPipeline = StaticPipelineDefinition<never>;

export function buildTraceIngestSourceBillingPipeline({
  billing,
}: {
  billing: Pick<TraceIngestSourceBillingService, "fold">;
}): TraceIngestSourceBillingPipeline {
  return (
    definePipeline({
      name: TRACE_INGEST_SOURCE_BILLING_PIPELINE_NAME,
      // `global`: trace appends no events of its own here; it only folds governance's.
      aggregate: defineAggregate({ type: "global" }),
    })
      .withEvents([])
      // The fold is idempotent and newer-wins, so a redelivered or late fact changes nothing.
      .withPeerSubscriber("traceIngestSourceBillingRecorded", {
        eventType: CODING_ASSISTANT_BILLING_EVENT_TYPES.RECORDED,
        data: codingAssistantBillingRecordedEventDataSchema,
        handle: (fact) => billing.fold(fact),
      })
      .build()
  );
}

export const traceIngestSourceBillingEventing = defineEventingModule({
  pipeline: TRACE_INGEST_SOURCE_BILLING_PIPELINE_NAME,
  build: ({ app }: EventingSetup<never, TraceModule>) => app.ingestSourceBillingPipeline(),
});
