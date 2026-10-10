/**
 * The one piece of work a daily run's process hands the outbox: carry out one run. The outbox
 * retries it and may deliver it twice, so the run it names must be safe to repeat.
 */

import type { IntentContext } from "@langwatch/eventing";
import { insightRunBoardSchema, insightRunMaxInsightsSchema } from "@langwatch/insight-contract";
import { z } from "zod";

export const INSIGHT_DAILY_RUN_INTENT = "runBoard" as const;

/** A model call that fails for good is not worth a fourth try. */
export const INSIGHT_DAILY_RUN_MAX_ATTEMPTS = 3;

/** Longer than a run may wait for Langy, so a slow run is never handed to a second pod. */
export const INSIGHT_DAILY_RUN_LEASE_MS = 20 * 60_000;

export const runBoardIntentSchema = z.object({
  scheduleId: z.string().min(1),
  userId: z.string().min(1),
  board: insightRunBoardSchema,
  maxInsights: insightRunMaxInsightsSchema,
  runId: z.string().min(1),
  /** The instant the run is for: its dates and its filings are fixed from it. */
  slot: z.number().int().nonnegative(),
  /** The run this one replaces: it never recorded an outcome, so this run records it first. */
  supersedes: z
    .object({ runId: z.string().min(1), slot: z.number().int().nonnegative() })
    .optional(),
});
export type RunBoardIntent = z.infer<typeof runBoardIntentSchema>;

/** Carries out one run for a project; late-bound to the service the module composes. */
export interface InsightDailyRunExecutor {
  run(input: RunBoardIntent & { projectId: string; isFinalAttempt: boolean }): Promise<void>;
}

export function runBoardIntent({
  runs,
}: {
  runs: InsightDailyRunExecutor;
}): (payload: RunBoardIntent, context: IntentContext) => Promise<void> {
  return (payload, context) =>
    runs.run({
      ...payload,
      projectId: context.projectId,
      isFinalAttempt: context.attempt >= INSIGHT_DAILY_RUN_MAX_ATTEMPTS,
    });
}
