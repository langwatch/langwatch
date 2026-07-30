import { NOTIFICATION_CADENCES } from "@langwatch/automations/cadences";
import { TriggerAction } from "@prisma/client";
import { z } from "zod";

/** `lw.automation.trigger.match_recorded` is already in `event_log`. */
export const AUTOMATIONS_PIPELINE_NAME = "trigger";
export const AUTOMATIONS_PIPELINE_PREFIX = "lw.automation";

export const triggerActionClassSchema = z.enum(["notify", "persist"]);

/** A match is a pointer into the trace pipeline's aggregate, never a copy of
 *  trace, span or message content (ADR-098 decision 8) — every dispatch
 *  re-reads the trace at dispatch time. */
export const matchRecordedDataSchema = z.object({
  triggerId: z.string().min(1),
  traceId: z.string().min(1),
  action: z.nativeEnum(TriggerAction),
  actionClass: triggerActionClassSchema,
  traceDebounceMs: z.number().int().nonnegative(),
  notificationCadence: z.enum(NOTIFICATION_CADENCES),
});
export type MatchRecordedData = z.infer<typeof matchRecordedDataSchema>;

export const automationsEvents = {
  matchRecorded: matchRecordedDataSchema,
} as const;
