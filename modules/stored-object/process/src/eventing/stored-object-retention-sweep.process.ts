import type { IntentSpec, WakeHandler } from "@langwatch/eventing";
import { z } from "zod";

export const STORED_OBJECT_RETENTION_SWEEP_PROCESS_NAME = "storedObjectRetentionSweep";

/** Hourly: an object outlives its last owner's retention by at most about an hour (ADR-002 §4). */
export const STORED_OBJECT_RETENTION_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/** Outbox rows are bookkeeping, one per sweep, pruned like every recurring process's. */
const SWEEP_ROW_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export const storedObjectRetentionSweepSchema = z.object({ scheduledFor: z.number().int() });

export const storedObjectRetentionSweepStateSchema = z.object({
  lastSweepAt: z.number().nullable(),
});
type StoredObjectRetentionSweepState = z.infer<typeof storedObjectRetentionSweepStateSchema>;

type StoredObjectRetentionSweepIntents = {
  sweep: IntentSpec<typeof storedObjectRetentionSweepSchema>;
};

/** Every wake asks for a sweep, so one that failed is retried on the next. */
export const storedObjectRetentionSweepWake: WakeHandler<
  StoredObjectRetentionSweepState,
  StoredObjectRetentionSweepIntents
> = (_state, ctx) => ({
  state: { lastSweepAt: ctx.at },
  intents: [ctx.intent("sweep", `sweep:${ctx.at}`, { scheduledFor: ctx.at })],
});

export interface StoredObjectRetentionSweepRunDeps {
  readonly sweep: () => Promise<unknown>;
  readonly deleteDispatchedBefore: (params: {
    processName: string;
    before: number;
  }) => Promise<number>;
  readonly now: () => number;
}

/** The prune is bookkeeping, and a failed one waits for the next sweep's. */
export function runStoredObjectRetentionSweep(
  deps: StoredObjectRetentionSweepRunDeps,
): () => Promise<void> {
  return async (): Promise<void> => {
    const startedAt = deps.now();
    await deps.sweep();
    await deps
      .deleteDispatchedBefore({
        processName: STORED_OBJECT_RETENTION_SWEEP_PROCESS_NAME,
        before: startedAt - SWEEP_ROW_RETENTION_MS,
      })
      .catch(() => 0);
  };
}
