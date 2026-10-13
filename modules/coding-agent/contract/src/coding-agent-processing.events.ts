import type { Named } from "@langwatch/module";
import { z } from "zod";

import {
  LOG_FACTS_CONTRIBUTED_EVENT_TYPE,
  METRIC_FACTS_CONTRIBUTED_EVENT_TYPE,
  SPAN_FACTS_CONTRIBUTED_EVENT_TYPE,
  SPAN_FACTS_LIFTED_PAYLOAD_TYPE,
  SPAN_FACTS_LIFTED_PAYLOAD_VERSIONS,
} from "./coding-agent-processing.constants.ts";
import {
  logFactsContributionSchema,
  metricFactsContributionSchema,
  spanFactsContributionSchema,
} from "./coding-agent-processing.ts";

const aggregateTypeSchema = z.string().trim().min(1);
const tenantIdSchema = z
  .string()
  .trim()
  .min(1, "[SECURITY] TenantId must be a non-empty string for tenant isolation")
  .brand<"TenantId">();
const eventMetadataSchema = z
  .object({ processingTraceparent: z.string().optional() })
  .passthrough();
const eventSchema = z.object({
  id: z.string(),
  aggregateId: z.string(),
  aggregateType: aggregateTypeSchema,
  tenantId: tenantIdSchema,
  createdAt: z.number().int().nonnegative(),
  occurredAt: z.number().int().nonnegative(),
  type: z.string().trim().min(1),
  version: z.string().date(),
  data: z.unknown(),
  metadata: eventMetadataSchema.optional(),
  idempotencyKey: z.string().optional(),
});

const spanFactsContributedEventSchemaDefinition = z.object({
  ...eventSchema.shape,
  type: z.literal(SPAN_FACTS_CONTRIBUTED_EVENT_TYPE),
  data: spanFactsContributionSchema,
});
export interface SpanFactsContributedEventSchema extends Named<
  typeof spanFactsContributedEventSchemaDefinition
> {}
export const spanFactsContributedEventSchema: SpanFactsContributedEventSchema =
  spanFactsContributedEventSchemaDefinition;
export type SpanFactsContributedEvent = z.infer<typeof spanFactsContributedEventSchema>;

const logFactsContributedEventSchemaDefinition = z.object({
  ...eventSchema.shape,
  type: z.literal(LOG_FACTS_CONTRIBUTED_EVENT_TYPE),
  data: logFactsContributionSchema,
});
export interface LogFactsContributedEventSchema extends Named<
  typeof logFactsContributedEventSchemaDefinition
> {}
export const logFactsContributedEventSchema: LogFactsContributedEventSchema =
  logFactsContributedEventSchemaDefinition;
export type LogFactsContributedEvent = z.infer<typeof logFactsContributedEventSchema>;

const metricFactsContributedEventSchemaDefinition = z.object({
  ...eventSchema.shape,
  type: z.literal(METRIC_FACTS_CONTRIBUTED_EVENT_TYPE),
  data: metricFactsContributionSchema,
});
export interface MetricFactsContributedEventSchema extends Named<
  typeof metricFactsContributedEventSchemaDefinition
> {}
export const metricFactsContributedEventSchema: MetricFactsContributedEventSchema =
  metricFactsContributedEventSchemaDefinition;
export type MetricFactsContributedEvent = z.infer<typeof metricFactsContributedEventSchema>;

export type CodingAgentProcessingEvent =
  | SpanFactsContributedEvent
  | LogFactsContributedEvent
  | MetricFactsContributedEvent;

// Staged queue payload (ADR-069) mirroring event envelope fields for rolling
// deploy compatibility; durable record is span_facts_contributed.
const spanFactsLiftedPayloadSchemaDefinition = z.object({
  id: z.string(),
  aggregateId: z.string(),
  aggregateType: aggregateTypeSchema,
  tenantId: tenantIdSchema,
  createdAt: z.number().int().nonnegative(),
  occurredAt: z.number().int().nonnegative(),
  type: z.literal(SPAN_FACTS_LIFTED_PAYLOAD_TYPE),
  version: z.enum(SPAN_FACTS_LIFTED_PAYLOAD_VERSIONS),
  data: spanFactsContributionSchema,
  metadata: eventMetadataSchema.optional(),
  idempotencyKey: z.string().optional(),
});
export interface SpanFactsLiftedPayloadSchema extends Named<
  typeof spanFactsLiftedPayloadSchemaDefinition
> {}
export const spanFactsLiftedPayloadSchema: SpanFactsLiftedPayloadSchema =
  spanFactsLiftedPayloadSchemaDefinition;
export type SpanFactsLiftedPayload = z.infer<typeof spanFactsLiftedPayloadSchema>;

// Discriminate on type first; returns null for non-lifted payloads, throws for
// unreadable versions to prevent silent no-ops in mixed deploys.
export function parseSpanFactsLiftedPayload(value: unknown): SpanFactsLiftedPayload | null {
  const candidate = z.object({ type: z.unknown() }).safeParse(value);
  if (!candidate.success || candidate.data.type !== SPAN_FACTS_LIFTED_PAYLOAD_TYPE) {
    return null;
  }
  return spanFactsLiftedPayloadSchema.parse(value);
}

export const contributeSpanFactsCommandDataSchema = spanFactsContributionSchema;
export type ContributeSpanFactsCommandData = z.infer<typeof contributeSpanFactsCommandDataSchema>;

export const contributeLogFactsCommandDataSchema = logFactsContributionSchema;
export type ContributeLogFactsCommandData = z.infer<typeof contributeLogFactsCommandDataSchema>;

export const contributeMetricFactsCommandDataSchema = metricFactsContributionSchema;
export type ContributeMetricFactsCommandData = z.infer<
  typeof contributeMetricFactsCommandDataSchema
>;
