import { z } from "zod";
import { NOTIFICATION_CADENCES } from "./cadences";
import { triggerActionSchema } from "./trigger";

export const RECORD_TRIGGER_MATCH_COMMAND_TYPE = "lw.automation.trigger.record_match" as const;
export const TRIGGER_MATCH_RECORDED_EVENT_TYPE = "lw.automation.trigger.match_recorded" as const;

/**
 * Bound for coalescing hot-trigger match commands into one event-log write.
 * The event contains identity and policy only; trace content stays outside
 * the durable automation event.
 */
export const TRIGGER_MATCH_COALESCE_MAX_BATCH = 200;

export const triggerActionClassSchema = z.enum(["notify", "persist"]);
export type TriggerActionClass = z.infer<typeof triggerActionClassSchema>;

export const triggerMatchRecordedEventDataSchema = z.object({
  triggerId: z.string().min(1),
  traceId: z.string().min(1),
  action: triggerActionSchema,
  actionClass: triggerActionClassSchema,
  traceDebounceMs: z.number().int().nonnegative(),
  notificationCadence: z.enum(NOTIFICATION_CADENCES),
});

export type TriggerMatchRecordedEventData = z.infer<typeof triggerMatchRecordedEventDataSchema>;
