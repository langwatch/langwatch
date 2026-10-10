// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  CODING_ASSISTANT_BILLING_AGGREGATE_TYPE,
  CODING_ASSISTANT_BILLING_COMMAND_TYPES,
  CODING_ASSISTANT_BILLING_EVENT_TYPES,
  CODING_ASSISTANT_BILLING_EVENT_VERSIONS,
  CODING_ASSISTANT_BILLING_PIPELINE_NAME,
  codingAssistantBillingAggregateId,
  codingAssistantBillingRecordKey,
  codingAssistantBillingRecordedEventDataSchema,
  codingAssistantBillingRecordedEventSchema,
  type CodingAssistantBillingRecordedEvent,
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
  type StaticPipelineDefinition,
} from "@langwatch/eventing";

import type { GovernanceModule } from "../app/governance.app.ts";
import type { GovernanceRepositories } from "../repositories/governance.repositories.ts";

type CodingAssistantBillingDefinition = StaticPipelineDefinition<
  CodingAssistantBillingRecordedEvent & Event,
  Record<string, Projection>,
  RegisteredCommand
>;

const RecordCodingAssistantBillingCommand = defineCommand({
  commandType: CODING_ASSISTANT_BILLING_COMMAND_TYPES.RECORD,
  eventType: CODING_ASSISTANT_BILLING_EVENT_TYPES.RECORDED,
  eventVersion: CODING_ASSISTANT_BILLING_EVENT_VERSIONS.RECORDED,
  aggregateType: CODING_ASSISTANT_BILLING_AGGREGATE_TYPE,
  schema: codingAssistantBillingRecordedEventDataSchema,
  aggregateId: (data) => codingAssistantBillingAggregateId(data),
  idempotencyKey: (data) => codingAssistantBillingRecordKey(data),
  spanAttributes: (data) => ({
    "payload.source_type": data.sourceType,
    "payload.billed": data.billed,
  }),
  makeJobId: (data) => codingAssistantBillingRecordKey(data),
});

/** A fact-only pipeline: governance records it, trace folds it; nothing here projects. */
function buildCodingAssistantBillingPipeline(): CodingAssistantBillingDefinition {
  return definePipeline({
    name: CODING_ASSISTANT_BILLING_PIPELINE_NAME,
    aggregate: defineAggregate({ type: CODING_ASSISTANT_BILLING_AGGREGATE_TYPE }),
  })
    .withEvents([codingAssistantBillingRecordedEventSchema])
    .withCommand("recordCodingAssistantBilling", RecordCodingAssistantBillingCommand)
    .build();
}

export const codingAssistantBillingEventing = defineEventingModule({
  pipeline: CODING_ASSISTANT_BILLING_PIPELINE_NAME,
  build: (_setup: EventingSetup<GovernanceRepositories, GovernanceModule>) =>
    buildCodingAssistantBillingPipeline(),
  connect: ({ app, commands }) => app.connectCodingAssistantBilling(commands),
});
