import type { IntentSpec, WakeHandler } from "@langwatch/eventing";
import { z } from "zod";

export const GITHUB_BRANCH_RECHECK_PROCESS_NAME = "githubBranchRecheck";

/**
 * How often the sweep runs, fleet-wide.
 *
 * Fleet-wide is the operative word. This used to be a `setTimeout` chain booted
 * on every worker replica with no lock, so a fleet of N replicas ran the same
 * cross-tenant scan N times every ten minutes and asked GitHub about the same
 * due branches N times. Nothing coordinated them but a 30-second boot jitter,
 * which staggers the collision rather than removing it.
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
 * Pure and synchronous, like every wake handler: the commit that persists this
 * evolution is what fences racing workers, so exactly one of them proceeds and
 * the losers observe a stale wake and stand down. The GitHub calls run as
 * intents behind the outbox lease instead.
 *
 * The prune rides the same wake, emitted only once its own interval has
 * elapsed. `ctx.at` is the slot the wake was scheduled for, which is the clock
 * a pure handler is allowed to read.
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
