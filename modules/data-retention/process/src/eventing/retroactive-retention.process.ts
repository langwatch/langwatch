import {
  type RetroactiveApplyRequestedData,
  type RetroactiveCancelRequestedData,
  type RetroactiveProgressRecordedData,
  type retroactiveApplyRequestedDataSchema,
  type retroactiveCancelRequestedDataSchema,
} from "@langwatch/data-retention-contract";
import type { EventHandler, IntentSpec, WakeHandler } from "@langwatch/eventing";
import { z } from "zod";

export const RETROACTIVE_RETENTION_PROCESS_NAME = "retroactiveRetention" as const;
/** How often a project's process re-reads its running rewrites; each move refreshes the panel. */
export const RETROACTIVE_PROGRESS_INTERVAL_MS = 15_000;
export const RETROACTIVE_APPLY_MAX_ATTEMPTS = 8;

export const retroactiveProgressRefreshSchema = z.object({
  projectId: z.string().min(1),
  scheduledFor: z.number().int(),
});

/** One project's process (keyed by the aggregate, the project): its wake, while rewrites run. */
export const retroactiveRetentionStateSchema = z.object({
  nextWakeAt: z.number().int().nullable(),
});
type RetroactiveRetentionState = z.infer<typeof retroactiveRetentionStateSchema>;
export const RETROACTIVE_RETENTION_INITIAL_STATE: RetroactiveRetentionState = {
  nextWakeAt: null,
};

type RetroactiveIntents = {
  applyRetention: IntentSpec<typeof retroactiveApplyRequestedDataSchema>;
  cancelMutation: IntentSpec<typeof retroactiveCancelRequestedDataSchema>;
  refreshProgress: IntentSpec<typeof retroactiveProgressRefreshSchema>;
};

/** An accepted apply becomes one durable intent, keyed by its request so a replay dedupes. */
export const retroactiveApplyRequested: EventHandler<
  RetroactiveRetentionState,
  RetroactiveApplyRequestedData,
  RetroactiveIntents
> = (state, data, ctx) => ({
  state,
  // The runtime clears an omitted wake, so a handler that keeps it says so.
  nextWakeAt: state.nextWakeAt,
  intents: [ctx.intent("applyRetention", `apply:${data.requestId}`, data)],
});

export const retroactiveCancelRequested: EventHandler<
  RetroactiveRetentionState,
  RetroactiveCancelRequestedData,
  RetroactiveIntents
> = (state, data, ctx) => ({
  state,
  nextWakeAt: state.nextWakeAt,
  intents: [ctx.intent("cancelMutation", `cancel:${data.requestId}`, data)],
});

/** A record with rewrites running arms the wake (or keeps it); one with none stops it. */
export const retroactiveProgressRecorded: EventHandler<
  RetroactiveRetentionState,
  RetroactiveProgressRecordedData,
  RetroactiveIntents
> = (state, data, ctx) => {
  if (data.mutations.length === 0) return { state: { nextWakeAt: null }, nextWakeAt: null };
  const nextWakeAt =
    state.nextWakeAt ?? Math.max(ctx.at, ctx.now) + RETROACTIVE_PROGRESS_INTERVAL_MS;
  return { state: { nextWakeAt }, nextWakeAt };
};

/** Each wake re-reads the project's rewrites and re-arms; the record that finds none stops it. */
export const retroactiveProgressWake: WakeHandler<RetroactiveRetentionState, RetroactiveIntents> = (
  state,
  ctx,
) => {
  if (state.nextWakeAt === null) return { state, nextWakeAt: null };
  const nextWakeAt = Math.max(ctx.at, ctx.now) + RETROACTIVE_PROGRESS_INTERVAL_MS;
  return {
    state: { nextWakeAt },
    nextWakeAt,
    intents: [
      ctx.intent("refreshProgress", `progress:${ctx.at}`, {
        projectId: ctx.key,
        scheduledFor: ctx.at,
      }),
    ],
  };
};
