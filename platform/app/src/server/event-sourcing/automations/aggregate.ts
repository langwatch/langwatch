import { NOTIFICATION_CADENCES } from "@langwatch/automations/cadences";
import { defineAggregate } from "@langwatch/event-sourcing";
import { TriggerAction } from "@prisma/client";
import { z } from "zod";

const triggerActionClassSchema = z.enum(["notify", "persist"]);
export type TriggerActionClass = z.infer<typeof triggerActionClassSchema>;

/**
 * Identity and timing config only. A match is a pointer into the trace
 * pipeline's aggregate, never a copy of trace, span or message content
 * (ADR-098 decision 8) — every dispatch re-reads the trace at dispatch time.
 */
export const matchRecordedDataSchema = z.object({
  triggerId: z.string().min(1),
  traceId: z.string().min(1),
  action: z.nativeEnum(TriggerAction),
  actionClass: triggerActionClassSchema,
  traceDebounceMs: z.number().int().nonnegative(),
  notificationCadence: z.enum(NOTIFICATION_CADENCES),
});
export type MatchRecordedData = z.infer<typeof matchRecordedDataSchema>;

/**
 * The `trigger` aggregate: a trace matched one automation's conditions.
 *
 * It carries no fold state. "This trigger's accumulated matches" is the
 * `triggerSettlement` process manager's durable state, not a read model
 * (ADR-098 decision 1), so this aggregate exists only to give a match a
 * durable, replayable identity in the event log.
 */
export const triggerAggregate = defineAggregate({
  name: "trigger",
  // `lw.automation.trigger.match_recorded` is already in `event_log`.
  prefix: "lw.automation",
  state: z.object({}).strict(),
  init: () => ({}),
  id: (data) => data.triggerId,
  events: {
    matchRecorded: {
      data: matchRecordedDataSchema,
      apply: (state) => state,
    },
  },
  commands: {
    recordMatch: {
      input: matchRecordedDataSchema,
      handle: (_state, input, events) => [events.matchRecorded(input)],
    },
  },
});

export type TriggerAggregate = typeof triggerAggregate;
export type TriggerAggregateState = ReturnType<TriggerAggregate["init"]>;
