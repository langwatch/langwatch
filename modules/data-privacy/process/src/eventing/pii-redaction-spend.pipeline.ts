import {
  PII_REDACTION_SPEND_AGGREGATE_TYPE,
  PII_REDACTION_SPEND_PIPELINE_NAME,
  type PiiRedactionSpendPricedEventData,
} from "@langwatch/data-privacy-contract";
/**
 * data-privacy's priced PII redaction model calls, one per answered batch, on the organization's
 * aggregate (ADR-201). Gateway's peer subscriber writes each as one spend row.
 * Spec: modules/data-privacy/specs/pii-redaction-billing.feature
 */
import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type Projection,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";

import type { DataPrivacyModule } from "../app/data-privacy.app.ts";
import type { DataPrivacyRepositories } from "../repositories/data-privacy.repositories.ts";
import {
  type PiiRedactionSpendPricedEvent,
  piiRedactionSpendPricedEventSchema,
  RecordPiiRedactionSpendPricedCommand,
} from "./pii-redaction-spend.commands.ts";

export type PiiRedactionSpendPipeline = StaticPipelineDefinition<
  PiiRedactionSpendPricedEvent,
  Record<string, Projection>,
  { name: "recordSpendPriced"; payload: PiiRedactionSpendPricedEventData }
>;

export function buildPiiRedactionSpendPipeline(): PiiRedactionSpendPipeline {
  return definePipeline({
    name: PII_REDACTION_SPEND_PIPELINE_NAME,
    aggregate: defineAggregate({ type: PII_REDACTION_SPEND_AGGREGATE_TYPE }),
  })
    .withEvents([piiRedactionSpendPricedEventSchema])
    .withCommand("recordSpendPriced", RecordPiiRedactionSpendPricedCommand)
    .build();
}

export const piiRedactionSpendEventing = defineEventingModule({
  pipeline: PII_REDACTION_SPEND_PIPELINE_NAME,
  build: ({ app }: EventingSetup<DataPrivacyRepositories, DataPrivacyModule>) =>
    app.spendPipeline(),
  connect: ({ app, commands }) => app.connectSpendCommands(commands),
});
