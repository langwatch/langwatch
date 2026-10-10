/**
 * The `insight` aggregate's durable events: the eventing envelope closed over each event's
 * type, version and the contract's payload schema.
 */

import { EventSchema } from "@langwatch/eventing";
import {
  INSIGHT_EVENT_TYPES,
  INSIGHT_EVENT_VERSIONS,
  insightFiledEventDataSchema,
  insightReaderEventDataSchema,
} from "@langwatch/insight-contract";
import { z } from "zod";

export const InsightFiledEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(INSIGHT_EVENT_TYPES.FILED),
  version: z.literal(INSIGHT_EVENT_VERSIONS.FILED),
  data: insightFiledEventDataSchema,
});
export type InsightFiledEvent = z.infer<typeof InsightFiledEventSchema>;

export const InsightSeenEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(INSIGHT_EVENT_TYPES.SEEN),
  version: z.literal(INSIGHT_EVENT_VERSIONS.SEEN),
  data: insightReaderEventDataSchema,
});
export type InsightSeenEvent = z.infer<typeof InsightSeenEventSchema>;

export const InsightArchivedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(INSIGHT_EVENT_TYPES.ARCHIVED),
  version: z.literal(INSIGHT_EVENT_VERSIONS.ARCHIVED),
  data: insightReaderEventDataSchema,
});
export type InsightArchivedEvent = z.infer<typeof InsightArchivedEventSchema>;

export const InsightKeptEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(INSIGHT_EVENT_TYPES.KEPT),
  version: z.literal(INSIGHT_EVENT_VERSIONS.KEPT),
  data: insightReaderEventDataSchema,
});
export type InsightKeptEvent = z.infer<typeof InsightKeptEventSchema>;

export type InsightReaderEvent = InsightSeenEvent | InsightArchivedEvent | InsightKeptEvent;

export type InsightProcessingEvent = InsightFiledEvent | InsightReaderEvent;

export const INSIGHT_EVENT_SCHEMAS = [
  InsightFiledEventSchema,
  InsightSeenEventSchema,
  InsightArchivedEventSchema,
  InsightKeptEventSchema,
] as const;
