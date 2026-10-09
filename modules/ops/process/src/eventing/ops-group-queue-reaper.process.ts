import type { IntentSpec, WakeHandler } from "@langwatch/eventing";
import { z } from "zod";

/** Hourly: the reap only touches groups stranded six hours or more, so sooner gains nothing. */
export const GROUP_QUEUE_REAPER_INTERVAL_MS = 60 * 60 * 1000;

export const groupQueueReapSchema = z.object({
  scheduledFor: z.number().int(),
});

export const groupQueueReaperStateSchema = z.object({
  lastReapedAt: z.number().nullable(),
});
type GroupQueueReaperState = z.infer<typeof groupQueueReaperStateSchema>;

export const GROUP_QUEUE_REAPER_INITIAL_STATE: GroupQueueReaperState = {
  lastReapedAt: null,
};

type GroupQueueReaperIntents = {
  reap: IntentSpec<typeof groupQueueReapSchema>;
};

/** Keyed by the wake, so a redelivered wake asks for its reap once. */
export const groupQueueReaperWake: WakeHandler<GroupQueueReaperState, GroupQueueReaperIntents> = (
  _state,
  ctx,
) => ({
  state: { lastReapedAt: ctx.at },
  intents: [ctx.intent("reap", `reap:${ctx.at}`, { scheduledFor: ctx.at })],
});
