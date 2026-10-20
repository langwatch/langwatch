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
  insightRenewedEventDataSchema,
} from "@langwatch/insight-contract";
import { z } from "zod";

export const InsightFiledEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(INSIGHT_EVENT_TYPES.FILED),
  version: z.literal(INSIGHT_EVENT_VERSIONS.FILED),
  data: insightFiledEventDataSchema,
});
export type InsightFiledEvent = z.infer<typeof InsightFiledEventSchema>;

export const InsightRenewedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(INSIGHT_EVENT_TYPES.RENEWED),
  version: z.literal(INSIGHT_EVENT_VERSIONS.RENEWED),
  data: insightRenewedEventDataSchema,
});
export type InsightRenewedEvent = z.infer<typeof InsightRenewedEventSchema>;

const InsightSeenEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(INSIGHT_EVENT_TYPES.SEEN),
  version: z.literal(INSIGHT_EVENT_VERSIONS.SEEN),
  data: insightReaderEventDataSchema,
});
type InsightSeenEvent = z.infer<typeof InsightSeenEventSchema>;

const InsightArchivedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(INSIGHT_EVENT_TYPES.ARCHIVED),
  version: z.literal(INSIGHT_EVENT_VERSIONS.ARCHIVED),
  data: insightReaderEventDataSchema,
});
type InsightArchivedEvent = z.infer<typeof InsightArchivedEventSchema>;

const InsightKeptEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(INSIGHT_EVENT_TYPES.KEPT),
  version: z.literal(INSIGHT_EVENT_VERSIONS.KEPT),
  data: insightReaderEventDataSchema,
});
type InsightKeptEvent = z.infer<typeof InsightKeptEventSchema>;

type InsightReaderEvent = InsightSeenEvent | InsightArchivedEvent | InsightKeptEvent;

export type InsightProcessingEvent = InsightFiledEvent | InsightRenewedEvent | InsightReaderEvent;

export const INSIGHT_EVENT_SCHEMAS = [
  InsightFiledEventSchema,
  InsightRenewedEventSchema,
  InsightSeenEventSchema,
  InsightArchivedEventSchema,
  InsightKeptEventSchema,
] as const;
