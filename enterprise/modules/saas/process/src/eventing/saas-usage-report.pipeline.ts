// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  SAAS_USAGE_REPORT_AGGREGATE_TYPE,
  SAAS_USAGE_REPORT_PIPELINE_NAME,
  USAGE_REPORT_RECEIVED_EVENT_TYPE,
  USAGE_REPORT_RECEIVED_EVENT_VERSION,
  type UsageReportReceivedEventData,
  usageReportReceivedEventDataSchema,
} from "@langwatch/enterprise-saas-contract";
import {
  defineAggregate,
  defineCommand,
  defineEventingModule,
  definePipeline,
  EventSchema,
  type CommandEnvelope,
  type EventingSetup,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";
import { z } from "zod";

import type { SaasModule } from "../app/saas.app.ts";

export const RECORD_USAGE_REPORT_RECEIVED_COMMAND_TYPE =
  "lw.saas.record_usage_report_received" as const;

const usageReportReceivedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(USAGE_REPORT_RECEIVED_EVENT_TYPE),
  version: z.literal(USAGE_REPORT_RECEIVED_EVENT_VERSION),
  data: usageReportReceivedEventDataSchema,
});

export type SaasUsageReportPipeline = StaticPipelineDefinition<
  z.infer<typeof usageReportReceivedEventSchema>,
  Record<string, never>,
  {
    name: "recordUsageReportReceived";
    payload: UsageReportReceivedEventData & CommandEnvelope;
  }
>;

/** One accepted report per install and instant; a retried send records it once. */
export const RecordUsageReportReceivedCommand = defineCommand({
  commandType: RECORD_USAGE_REPORT_RECEIVED_COMMAND_TYPE,
  eventType: USAGE_REPORT_RECEIVED_EVENT_TYPE,
  eventVersion: USAGE_REPORT_RECEIVED_EVENT_VERSION,
  aggregateType: SAAS_USAGE_REPORT_AGGREGATE_TYPE,
  schema: usageReportReceivedEventDataSchema,
  aggregateId: ({ instanceId }) => instanceId,
  idempotencyKey: ({ instanceId, occurredAt }) => `${instanceId}:${occurredAt}`,
});

/** saas_usage_report: saas records the fact; nurturing reacts from its side (§9, rule 7). */
export function buildSaasUsageReportPipeline(): SaasUsageReportPipeline {
  return definePipeline({
    name: SAAS_USAGE_REPORT_PIPELINE_NAME,
    aggregate: defineAggregate({ type: SAAS_USAGE_REPORT_AGGREGATE_TYPE }),
  })
    .withEvents([usageReportReceivedEventSchema])
    .withCommand("recordUsageReportReceived", RecordUsageReportReceivedCommand)
    .build();
}

export const saasUsageReportEventing = defineEventingModule({
  pipeline: SAAS_USAGE_REPORT_PIPELINE_NAME,
  build: (_setup: EventingSetup<never, SaasModule>) => buildSaasUsageReportPipeline(),
  connect: ({ app, commands }) => app.connectCommands(commands),
});
