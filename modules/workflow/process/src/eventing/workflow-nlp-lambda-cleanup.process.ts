import type { IntentSpec, WakeHandler } from "@langwatch/eventing";
import { z } from "zod";

export const NLP_LAMBDA_CLEANUP_PROCESS_NAME = "workflowNlpLambdaCleanup";

/** Daily: main's `/api/cron/old_lambdas_cleanup` had no schedule in any chart here. */
export const NLP_LAMBDA_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Outbox rows are bookkeeping, one per sweep, pruned like every recurring process's. */
const SWEEP_ROW_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export const nlpLambdaCleanupSweepSchema = z.object({ scheduledFor: z.number().int() });

export const nlpLambdaCleanupStateSchema = z.object({
  lastSweepAt: z.number().nullable(),
});
export type NlpLambdaCleanupState = z.infer<typeof nlpLambdaCleanupStateSchema>;

type NlpLambdaCleanupIntents = {
  sweep: IntentSpec<typeof nlpLambdaCleanupSweepSchema>;
};

/** Every wake asks for a sweep, so one that failed is retried on the next. */
export const nlpLambdaCleanupWake: WakeHandler<NlpLambdaCleanupState, NlpLambdaCleanupIntents> = (
  _state,
  ctx,
) => ({
  state: { lastSweepAt: ctx.at },
  intents: [ctx.intent("sweep", `sweep:${ctx.at}`, { scheduledFor: ctx.at })],
});

export interface NlpLambdaCleanupRunDeps {
  readonly sweep: () => Promise<void>;
  readonly deleteDispatchedBefore: (params: {
    processName: string;
    before: number;
  }) => Promise<number>;
  readonly now: () => number;
}

/** The prune is bookkeeping, and a failed one waits for the next day's. */
export function runNlpLambdaCleanup(deps: NlpLambdaCleanupRunDeps): () => Promise<void> {
  return async (): Promise<void> => {
    const startedAt = deps.now();
    await deps.sweep();
    await deps
      .deleteDispatchedBefore({
        processName: NLP_LAMBDA_CLEANUP_PROCESS_NAME,
        before: startedAt - SWEEP_ROW_RETENTION_MS,
      })
      .catch(() => 0);
  };
}
