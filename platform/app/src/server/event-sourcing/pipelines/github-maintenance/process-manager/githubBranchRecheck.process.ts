import type { IntentSpec, WakeHandler } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import { z } from "zod";

const logger = createLogger("langwatch:github:branch-recheck");

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

/**
 * Outbox rows this process writes are pure bookkeeping (one or two per tick),
 * pruned on the schedule the high-frequency recurring processes use.
 */
const OUTBOX_ROW_RETENTION_MS = 24 * 60 * 60 * 1000;

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

export interface GithubBranchRecheckDeps {
  /** One sweep pass; returns how many branches were rechecked. */
  recheck: () => Promise<number>;
  /** Deletes the bookkeeping past the activity horizon; returns what it removed. */
  prune: () => Promise<{ branchChecks: number }>;
  deleteDispatchedBefore: (params: {
    processName: string;
    before: number;
  }) => Promise<number>;
  now?: () => number;
}

type GithubBranchRecheckIntents = {
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
    state.lastPruneAt === null ||
    ctx.at - state.lastPruneAt >= GITHUB_RETENTION_PRUNE_INTERVAL_MS;

  return {
    state: {
      lastRecheckAt: ctx.at,
      lastPruneAt: prunable ? ctx.at : state.lastPruneAt,
    },
    intents: [
      ctx.intents.recheck(`recheck:${ctx.at}`, { scheduledFor: ctx.at }),
      ...(prunable
        ? [ctx.intents.prune(`prune:${ctx.at}`, { scheduledFor: ctx.at })]
        : []),
    ],
  };
};

export function runGithubBranchRecheck(deps: GithubBranchRecheckDeps) {
  return async (): Promise<void> => {
    const rechecked = await deps.recheck();
    if (rechecked > 0) {
      logger.info({ rechecked }, "branch recheck tick complete");
    }
  };
}

export function runGithubRetentionPrune(deps: GithubBranchRecheckDeps) {
  return async (): Promise<void> => {
    const startedAt = (deps.now ?? Date.now)();
    const { branchChecks } = await deps.prune();
    if (branchChecks > 0) {
      logger.info(
        { branchChecks },
        "GitHub branch bookkeeping pruned past the activity horizon",
      );
    }

    try {
      await deps.deleteDispatchedBefore({
        processName: GITHUB_BRANCH_RECHECK_PROCESS_NAME,
        before: startedAt - OUTBOX_ROW_RETENTION_MS,
      });
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        "GitHub branch recheck outbox retention failed",
      );
    }
  };
}
