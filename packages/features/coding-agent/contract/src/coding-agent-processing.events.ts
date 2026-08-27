import { z } from "zod";
import {
  LOG_FACTS_CONTRIBUTED_EVENT_TYPE,
  METRIC_FACTS_CONTRIBUTED_EVENT_TYPE,
  SPAN_FACTS_CONTRIBUTED_EVENT_TYPE,
  SPAN_FACTS_LIFTED_PAYLOAD_TYPE,
  SPAN_FACTS_LIFTED_PAYLOAD_VERSIONS,
} from "./coding-agent-processing.constants";
import {
  logFactsContributionSchema,
  metricFactsContributionSchema,
  spanFactsContributionSchema,
} from "./coding-agent-processing";

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

export const spanFactsContributedEventSchema = eventSchema.extend({
  type: z.literal(SPAN_FACTS_CONTRIBUTED_EVENT_TYPE),
  data: spanFactsContributionSchema,
});
export type SpanFactsContributedEvent = z.infer<typeof spanFactsContributedEventSchema>;

export const logFactsContributedEventSchema = eventSchema.extend({
  type: z.literal(LOG_FACTS_CONTRIBUTED_EVENT_TYPE),
  data: logFactsContributionSchema,
});
export type LogFactsContributedEvent = z.infer<typeof logFactsContributedEventSchema>;

export const metricFactsContributedEventSchema = eventSchema.extend({
  type: z.literal(METRIC_FACTS_CONTRIBUTED_EVENT_TYPE),
  data: metricFactsContributionSchema,
});
export type MetricFactsContributedEvent = z.infer<typeof metricFactsContributedEventSchema>;

export type CodingAgentProcessingEvent =
  | SpanFactsContributedEvent
  | LogFactsContributedEvent
  | MetricFactsContributedEvent;

/**
 * The staged bounded derivation (ADR-069): a matched span's facts, lifted at
 * the routing seam and carried on the job so the handler needs no read-back.
 *
 * This is a STAGED QUEUE PAYLOAD, not an event — a plain versioned DTO owned
 * by the dispatch lane. It is never appended to the event log; the durable
 * record of the contribution is `span_facts_contributed`. Its fields mirror
 * the event envelope field-for-field (same names, same validators) because
 * the payload travels the queue in a trace event's place and the handler
 * discriminates on `type` and `version` and reads `tenantId` + `data`.
 * Keeping the wire shape byte-identical is what leaves the rolling deploy
 * (consumer half first, R2 flips the producer) unaffected.
 */
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

/**
 * Discriminate-then-validate read of a staged payload, mirroring
 * `parseSpanReferencedPayload`.
 *
 * Returns `null` when the payload does not even claim to be a lifted
 * derivation, so the caller falls through to its other shapes. But once the
 * payload claims the type, a shape or version this build cannot read THROWS
 * into the queue's retry — falling through would let a mixed-deploy job be
 * mistaken for another kind of payload and silently no-op.
 */
export function parseSpanFactsLiftedPayload(value: unknown): SpanFactsLiftedPayload | null {
  const candidate = z.object({ type: z.unknown() }).safeParse(value);
  if (!candidate.success || candidate.data.type !== SPAN_FACTS_LIFTED_PAYLOAD_TYPE) {
    return null;
  }
  return spanFactsLiftedPayloadSchema.parse(value);
}
