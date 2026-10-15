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
  insightScheduleConfiguredEventDataSchema,
  insightScheduleTurnedOffEventDataSchema,
} from "@langwatch/insight-contract";
import { z } from "zod";

export const InsightScheduleConfiguredEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(INSIGHT_DAILY_RUN_EVENT_TYPES.CONFIGURED),
  version: z.literal(INSIGHT_DAILY_RUN_EVENT_VERSION),
  data: insightScheduleConfiguredEventDataSchema,
});
type InsightScheduleConfiguredEvent = z.infer<typeof InsightScheduleConfiguredEventSchema>;

export const InsightScheduleTurnedOffEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(INSIGHT_DAILY_RUN_EVENT_TYPES.TURNED_OFF),
  version: z.literal(INSIGHT_DAILY_RUN_EVENT_VERSION),
  data: insightScheduleTurnedOffEventDataSchema,
});
type InsightScheduleTurnedOffEvent = z.infer<typeof InsightScheduleTurnedOffEventSchema>;

/** A reconcile pass hands the process the row's settings: the same data as `configured`. */
export const InsightScheduleRearmRequestedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(INSIGHT_DAILY_RUN_EVENT_TYPES.REARM_REQUESTED),
  version: z.literal(INSIGHT_DAILY_RUN_EVENT_VERSION),
  data: insightScheduleConfiguredEventDataSchema,
});
type InsightScheduleRearmRequestedEvent = z.infer<typeof InsightScheduleRearmRequestedEventSchema>;

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
  | InsightScheduleConfiguredEvent
  | InsightScheduleTurnedOffEvent
  | InsightScheduleRearmRequestedEvent
  | InsightRunRequestedEvent
  | InsightRunStartedEvent
  | InsightRunSettledEvent;

export const INSIGHT_DAILY_RUN_EVENT_SCHEMAS = [
  InsightScheduleConfiguredEventSchema,
  InsightScheduleTurnedOffEventSchema,
  InsightScheduleRearmRequestedEventSchema,
  InsightRunRequestedEventSchema,
  InsightRunStartedEventSchema,
  InsightRunSettledEventSchema,
] as const;
