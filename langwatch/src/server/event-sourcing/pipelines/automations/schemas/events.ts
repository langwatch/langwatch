import { TriggerAction } from "@prisma/client";
import { z } from "zod";
import { NOTIFICATION_CADENCES } from "~/shared/automations/cadences";

import { EventSchema } from "../../../domain/types";
import { TRIGGER_MATCH_RECORDED_EVENT_TYPE } from "./constants";

export const triggerActionClassSchema = z.enum(["notify", "persist"]);
export type TriggerActionClass = z.infer<typeof triggerActionClassSchema>;

/** Identity and timing config only. Trace/span/message content is forbidden. */
export const triggerMatchRecordedEventDataSchema = z.object({
  triggerId: z.string().min(1),
  traceId: z.string().min(1),
  action: z.nativeEnum(TriggerAction),
  actionClass: triggerActionClassSchema,
  traceDebounceMs: z.number().int().nonnegative(),
  notificationCadence: z.enum(NOTIFICATION_CADENCES),
});

export const triggerMatchRecordedEventSchema = EventSchema.extend({
  type: z.literal(TRIGGER_MATCH_RECORDED_EVENT_TYPE),
  data: triggerMatchRecordedEventDataSchema,
});

export type TriggerMatchRecordedEventData = z.infer<
  typeof triggerMatchRecordedEventDataSchema
>;
export type TriggerMatchRecordedEvent = z.infer<
  typeof triggerMatchRecordedEventSchema
>;
export type AutomationEvent = TriggerMatchRecordedEvent;
