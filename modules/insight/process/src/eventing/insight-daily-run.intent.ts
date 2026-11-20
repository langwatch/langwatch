/**
 * The one piece of work a daily run's process hands the outbox: carry out one run. The outbox
 * retries it and may deliver it twice, so the run it names must be safe to repeat.
 */

import type { IntentContext } from "@langwatch/eventing";
import { insightRunBoardSchema, insightRunMaxInsightsSchema } from "@langwatch/insight-contract";
import { z } from "zod";

export const INSIGHT_DAILY_RUN_INTENT = "runBoard" as const;

/**
 * Four tries: the held session key spans them, and an unlanded grant fails with `retryAfterMs`,
 * which the outbox honours. Folds have no fixed lag; three 40 s waits give at least 120 s, which
 * covered a proof run's 114 s (langwatch/langwatch#9506). A model call failing for good: no fifth.
 */
export const INSIGHT_DAILY_RUN_MAX_ATTEMPTS = 4;

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
  /**
   * The scheduled days in a row that ended skipped before this run. Absent on an operator's
   * run, which is no scheduled day, and on a run handed over before the count existed.
   */
  skippedDaysBefore: z.number().int().nonnegative().optional(),
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
