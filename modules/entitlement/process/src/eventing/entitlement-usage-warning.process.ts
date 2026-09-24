import type { IntentSpec, WakeHandler } from "@langwatch/eventing";
import { z } from "zod";

export const USAGE_WARNING_SWEEP_PROCESS_NAME = "entitlementUsageWarningSweep";

/** Daily. Main's cadence was the external SaaS CronJob, which this repository never scheduled. */
export const USAGE_WARNING_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Outbox rows are bookkeeping, one per sweep, pruned like every recurring process's. */
const SWEEP_ROW_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export const usageWarningSweepSchema = z.object({ scheduledFor: z.number().int() });

export interface UsageWarningSweepState {
  lastSweepAt: number | null;
}

type UsageWarningSweepIntents = {
  sweep: IntentSpec<typeof usageWarningSweepSchema>;
};

/** Pure and synchronous: the sweep itself is an intent, run behind the outbox lease. */
export const usageWarningSweepWake: WakeHandler<
  UsageWarningSweepState,
  UsageWarningSweepIntents
> = (_state, ctx) => ({
  state: { lastSweepAt: ctx.at },
  intents: [ctx.intents.sweep(`sweep:${ctx.at}`, { scheduledFor: ctx.at })],
});

export interface UsageWarningSweepRunDeps {
  readonly sweep: () => Promise<void>;
  readonly deleteDispatchedBefore: (params: {
    processName: string;
    before: number;
  }) => Promise<number>;
  readonly now: () => number;
}

/** The prune is bookkeeping, and a failed one waits for the next day's. */
export function runUsageWarningSweep(deps: UsageWarningSweepRunDeps): () => Promise<void> {
  return async (): Promise<void> => {
    const startedAt = deps.now();
    await deps.sweep();
    await deps
      .deleteDispatchedBefore({
        processName: USAGE_WARNING_SWEEP_PROCESS_NAME,
        before: startedAt - SWEEP_ROW_RETENTION_MS,
      })
      .catch(() => 0);
  };
}
