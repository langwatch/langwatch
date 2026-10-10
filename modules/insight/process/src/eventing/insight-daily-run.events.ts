/**
 * The `insight_daily_schedule` aggregate's durable events: the eventing envelope closed over
 * each event's type, version and the contract's payload schema.
 */

import { EventSchema } from "@langwatch/eventing";
import {
  INSIGHT_DAILY_RUN_EVENT_TYPES,
  INSIGHT_DAILY_RUN_EVENT_VERSION,
  insightRunRequestedEventDataSchema,
  insightRunSettledEventDataSchema,
  insightRunStartedEventDataSchema,
} from "@langwatch/insight-contract";
import { z } from "zod";

export const InsightRunRequestedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(INSIGHT_DAILY_RUN_EVENT_TYPES.RUN_REQUESTED),
  version: z.literal(INSIGHT_DAILY_RUN_EVENT_VERSION),
  data: insightRunRequestedEventDataSchema,
});
type InsightRunRequestedEvent = z.infer<typeof InsightRunRequestedEventSchema>;

const InsightRunStartedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(INSIGHT_DAILY_RUN_EVENT_TYPES.RUN_STARTED),
  version: z.literal(INSIGHT_DAILY_RUN_EVENT_VERSION),
  data: insightRunStartedEventDataSchema,
});
type InsightRunStartedEvent = z.infer<typeof InsightRunStartedEventSchema>;

export const InsightRunSettledEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(INSIGHT_DAILY_RUN_EVENT_TYPES.RUN_SETTLED),
  version: z.literal(INSIGHT_DAILY_RUN_EVENT_VERSION),
  data: insightRunSettledEventDataSchema,
});
type InsightRunSettledEvent = z.infer<typeof InsightRunSettledEventSchema>;

export type InsightDailyRunEvent =
  | InsightRunRequestedEvent
  | InsightRunStartedEvent
  | InsightRunSettledEvent;

export const INSIGHT_DAILY_RUN_EVENT_SCHEMAS = [
  InsightRunRequestedEventSchema,
  InsightRunStartedEventSchema,
  InsightRunSettledEventSchema,
] as const;
