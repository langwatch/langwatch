import { NOTIFICATION_CADENCES } from "@langwatch/automations/cadences";
import { TriggerAction } from "@prisma/client";
import { z } from "zod";

import { EventSchema } from "../../../domain/types";
import {
  TRIGGER_MATCH_RECORDED_EVENT_TYPE,
  TRIGGER_MATCH_RECORDED_EVENT_VERSION_LATEST,
} from "./constants";

const triggerActionClassSchema = z.enum(["notify", "persist"]);
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
  version: z.literal(TRIGGER_MATCH_RECORDED_EVENT_VERSION_LATEST),
  data: triggerMatchRecordedEventDataSchema,
});

export type TriggerMatchRecordedEventData = z.infer<
  typeof triggerMatchRecordedEventDataSchema
>;
type TriggerMatchRecordedEvent = z.infer<
  typeof triggerMatchRecordedEventSchema
>;
export type AutomationEvent = TriggerMatchRecordedEvent;
