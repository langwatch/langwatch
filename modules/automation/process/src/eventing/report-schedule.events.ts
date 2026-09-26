import {
  REPORT_SCHEDULE_EVENT_TYPES,
  reportRunRequestedEventDataSchema,
  reportScheduleConfiguredEventDataSchema,
  reportScheduleTargetEventDataSchema,
} from "@langwatch/automation-contract";
import { EventSchema } from "@langwatch/eventing";
import { z } from "zod";

export const REPORT_SCHEDULE_EVENT_VERSION = "2026-09-26" as const;

export const reportScheduleConfiguredEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(REPORT_SCHEDULE_EVENT_TYPES.CONFIGURED),
  data: reportScheduleConfiguredEventDataSchema,
});

export const reportSchedulePausedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(REPORT_SCHEDULE_EVENT_TYPES.PAUSED),
  data: reportScheduleTargetEventDataSchema,
});

export const reportScheduleResumedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(REPORT_SCHEDULE_EVENT_TYPES.RESUMED),
  data: reportScheduleTargetEventDataSchema,
});

export const reportRunRequestedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(REPORT_SCHEDULE_EVENT_TYPES.RUN_REQUESTED),
  data: reportRunRequestedEventDataSchema,
});

export const reportScheduleEventSchemas = [
  reportScheduleConfiguredEventSchema,
  reportSchedulePausedEventSchema,
  reportScheduleResumedEventSchema,
  reportRunRequestedEventSchema,
] as const;

export type ReportScheduleEvent = z.infer<(typeof reportScheduleEventSchemas)[number]>;
