// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  INGESTED_COST_AGGREGATE_TYPE,
  INGESTED_COST_COMMAND_TYPES,
  INGESTED_COST_EVENT_TYPES,
  INGESTED_COST_EVENT_VERSIONS,
  INGESTED_COST_PIPELINE_NAME,
  ingestedCostKey,
  ingestedCostRecordedEventDataSchema,
  ingestedCostRecordedEventSchema,
  type IngestedCostRecordedEvent,
} from "@langwatch/enterprise-governance-contract";
import {
  defineAggregate,
  defineCommand,
  defineEventingModule,
  definePipeline,
  type Event,
  type EventingSetup,
  type Projection,
  type RegisteredCommand,
  type RetentionPolicyResolver,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";

import type { GovernanceModule } from "../../../app/governance.app.ts";
import type { GovernanceRepositories } from "../../../repositories/governance.repositories.ts";

export type IngestedCostDefinition = StaticPipelineDefinition<
  IngestedCostRecordedEvent & Event,
  Record<string, Projection>,
  RegisteredCommand
>;

const RecordIngestedCostCommand = defineCommand({
  commandType: INGESTED_COST_COMMAND_TYPES.RECORD,
  eventType: INGESTED_COST_EVENT_TYPES.RECORDED,
  eventVersion: INGESTED_COST_EVENT_VERSIONS.RECORDED,
  aggregateType: INGESTED_COST_AGGREGATE_TYPE,
  schema: ingestedCostRecordedEventDataSchema,
  aggregateId: (data) => ingestedCostKey(data),
  idempotencyKey: (data) => ingestedCostKey(data),
  spanAttributes: (data) => ({
    "payload.ingestion_source_id": data.ingestionSourceId,
    "payload.source_type": data.sourceType,
    "payload.amount_nano_usd": data.amountNanoUsd,
  }),
  makeJobId: (data) => ingestedCostKey(data),
});

/**
 * A fact-only pipeline: the push receiver records each cost it read, and gateway's budget
 * ledger peer-subscribes and debits it (as for pulled usage, Q208C), so no ledger row is
 * written in the request. Spec: specs/ai-gateway/governance/ingested-cost-ledger.feature
 */
export function buildIngestedCostPipeline({
  retention,
}: {
  retention?: RetentionPolicyResolver | undefined;
} = {}): IngestedCostDefinition {
  const pipeline = definePipeline({
    name: INGESTED_COST_PIPELINE_NAME,
    aggregate: defineAggregate({ type: INGESTED_COST_AGGREGATE_TYPE }),
  })
    .withEvents([ingestedCostRecordedEventSchema])
    .withCommand("recordIngestedCost", RecordIngestedCostCommand);
  if (retention) pipeline.withRetention(retention);
  return pipeline.build();
}

export const ingestedCostEventing = defineEventingModule({
  pipeline: INGESTED_COST_PIPELINE_NAME,
  build: ({ app }: EventingSetup<GovernanceRepositories, GovernanceModule>) =>
    app.ingestedCostPipeline(),
  connect: ({ app, commands }) => app.connectIngestedCost(commands),
});
