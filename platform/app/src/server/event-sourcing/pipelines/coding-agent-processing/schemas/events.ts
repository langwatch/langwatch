import { z } from "zod";
import { EventSchema } from "../../../domain/types";
import {
  LOG_FACTS_CONTRIBUTED_EVENT_TYPE,
  METRIC_FACTS_CONTRIBUTED_EVENT_TYPE,
  SPAN_FACTS_CONTRIBUTED_EVENT_TYPE,
  SPAN_FACTS_LIFTED_EVENT_TYPE,
  SPAN_FACTS_LIFTED_EVENT_VERSIONS,
} from "./constants";
import {
  logFactsContributionSchema,
  metricFactsContributionSchema,
  spanFactsContributionSchema,
} from "./contributions";

export const spanFactsContributedEventSchema = EventSchema.extend({
  type: z.literal(SPAN_FACTS_CONTRIBUTED_EVENT_TYPE),
  data: spanFactsContributionSchema,
});
export type SpanFactsContributedEvent = z.infer<
  typeof spanFactsContributedEventSchema
>;

export const logFactsContributedEventSchema = EventSchema.extend({
  type: z.literal(LOG_FACTS_CONTRIBUTED_EVENT_TYPE),
  data: logFactsContributionSchema,
});
export type LogFactsContributedEvent = z.infer<
  typeof logFactsContributedEventSchema
>;

export const metricFactsContributedEventSchema = EventSchema.extend({
  type: z.literal(METRIC_FACTS_CONTRIBUTED_EVENT_TYPE),
  data: metricFactsContributionSchema,
});
export type MetricFactsContributedEvent = z.infer<
  typeof metricFactsContributedEventSchema
>;

export type CodingAgentProcessingEvent =
  | SpanFactsContributedEvent
  | LogFactsContributedEvent
  | MetricFactsContributedEvent;

/**
 * The staged bounded derivation (ADR-069): a matched span's facts, lifted at
 * the routing seam and carried on the job so the handler needs no read-back.
 * Never appended to the event log — see the constant's docblock.
 */
export const spanFactsLiftedEventSchema = EventSchema.extend({
  type: z.literal(SPAN_FACTS_LIFTED_EVENT_TYPE),
  version: z.enum(SPAN_FACTS_LIFTED_EVENT_VERSIONS),
  data: spanFactsContributionSchema,
});
export type SpanFactsLiftedEvent = z.infer<typeof spanFactsLiftedEventSchema>;

/**
 * Discriminate-then-validate read of a staged payload, mirroring
 * `parseSpanReferencedEvent`.
 *
 * Returns `null` when the payload does not even claim to be a lifted
 * derivation, so the caller falls through to its other shapes. But once the
 * payload claims the type, a shape or version this build cannot read THROWS
 * into the queue's retry — falling through would let a mixed-deploy job be
 * mistaken for another kind of payload and silently no-op.
 */
export function parseSpanFactsLiftedEvent(
  value: unknown,
): SpanFactsLiftedEvent | null {
  if (typeof value !== "object" || value === null) return null;
  if ((value as { type?: unknown }).type !== SPAN_FACTS_LIFTED_EVENT_TYPE) {
    return null;
  }
  return spanFactsLiftedEventSchema.parse(value);
}
