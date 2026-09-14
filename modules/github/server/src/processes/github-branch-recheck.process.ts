import type { IntentSpec, WakeHandler } from "@langwatch/eventing";
import { z } from "zod";

export const GITHUB_BRANCH_RECHECK_PROCESS_NAME = "githubBranchRecheck";

/**
 * How often the sweep runs, fleet-wide, to avoid duplicate runs across
 * worker replicas.
 */
export const GITHUB_BRANCH_RECHECK_INTERVAL_MS = 10 * 60 * 1000;

/**
 * How often the branch bookkeeping is pruned. Retention is a daily concern and
 * the sweep is a ten-minute one, so the prune rides the same schedule and fires
 * on the first wake past its own interval rather than carrying a second
 * singleton. This mirrors the automations pipeline, which hangs its
 * trigger-settlement retention off the webhook prune's daily wake for the same
 * reason.
 */
export const GITHUB_RETENTION_PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;

export const githubBranchRecheckSchema = z.object({
  scheduledFor: z.number().int(),
});

export interface GithubBranchRecheckState {
  lastRecheckAt: number | null;
  lastPruneAt: number | null;
}

export const GITHUB_BRANCH_RECHECK_INITIAL_STATE: GithubBranchRecheckState = {
  lastRecheckAt: null,
  lastPruneAt: null,
};

export type GithubBranchRecheckIntents = {
  recheck: IntentSpec<typeof githubBranchRecheckSchema>;
  prune: IntentSpec<typeof githubBranchRecheckSchema>;
};

/**
 * Pure handler coordinating workers via commit; the prune rides the same
 * wake, gated by its own interval.
 */
export const githubBranchRecheckWake: WakeHandler<
  GithubBranchRecheckState,
  GithubBranchRecheckIntents
> = (state, ctx) => {
  const prunable =
    state.lastPruneAt === null || ctx.at - state.lastPruneAt >= GITHUB_RETENTION_PRUNE_INTERVAL_MS;

  return {
    state: {
      lastRecheckAt: ctx.at,
      lastPruneAt: prunable ? ctx.at : state.lastPruneAt,
    },
    intents: [
      ctx.intents.recheck(`recheck:${ctx.at}`, { scheduledFor: ctx.at }),
      ...(prunable ? [ctx.intents.prune(`prune:${ctx.at}`, { scheduledFor: ctx.at })] : []),
    ],
  };
};
