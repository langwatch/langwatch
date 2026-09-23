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

export const spanFactsContributedEventSchema = z.object({
  ...eventSchema.shape,
  type: z.literal(SPAN_FACTS_CONTRIBUTED_EVENT_TYPE),
  data: spanFactsContributionSchema,
});
export type SpanFactsContributedEvent = z.infer<typeof spanFactsContributedEventSchema>;

export const logFactsContributedEventSchema = z.object({
  ...eventSchema.shape,
  type: z.literal(LOG_FACTS_CONTRIBUTED_EVENT_TYPE),
  data: logFactsContributionSchema,
});
export type LogFactsContributedEvent = z.infer<typeof logFactsContributedEventSchema>;

export const metricFactsContributedEventSchema = z.object({
  ...eventSchema.shape,
  type: z.literal(METRIC_FACTS_CONTRIBUTED_EVENT_TYPE),
  data: metricFactsContributionSchema,
});
export type MetricFactsContributedEvent = z.infer<typeof metricFactsContributedEventSchema>;

export type CodingAgentProcessingEvent =
  | SpanFactsContributedEvent
  | LogFactsContributedEvent
  | MetricFactsContributedEvent;

// Staged queue payload (ADR-069) mirroring event envelope fields for rolling
// deploy compatibility; durable record is span_facts_contributed.
export const spanFactsLiftedPayloadSchema = z.object({
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
