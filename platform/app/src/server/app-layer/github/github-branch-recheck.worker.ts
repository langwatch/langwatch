/**
 * The periodic branch recheck: the half of pull-request linkage that works
 * without any new session activity.
 *
 * A session's branch usually has no pull request when it folds: the work comes
 * first, the pull request follows, sometimes days later. The fold-driven
 * mapping cannot see that: it only runs when a session is folded, and by then
 * the branch may never be touched again. This tick is what closes that gap. It
 * picks up the branches that mapped to nothing, whose backoff has elapsed, and
 * that a reader still cares about, and asks GitHub once more.
 *
 * "Still cares about" is the load-bearing cut. Without it the sweep would grow
 * without bound, asking GitHub daily about every branch any session ever ran on
 * since the connection was made.
 *
 * Spec: specs/coding-agent/pull-request-linkage.feature.
 */
import { createLogger } from "@langwatch/observability";

import type { GithubPullRequestMappingService } from "./github-pull-request-mapping.service";
import type { GithubPullRequestsRepository } from "./repositories/github-pull-requests.repository";

const logger = createLogger("langwatch:github:branch-recheck");

/** How often the sweep runs. */
export const RECHECK_TICK_MS = 10 * 60 * 1000;
/**
 * How long since a reader last asked before a branch drops out of the sweep.
 * A week is generous for a branch someone is still working on and short enough
 * that an abandoned one stops costing GitHub calls.
 */
export const RECHECK_ACTIVE_WITHIN_MS = 7 * 24 * 60 * 60 * 1000;
/** Branches per tick. Each one is a GitHub call, so the tick stays small. */
export const RECHECK_BATCH_LIMIT = 50;
/**
 * Spread the first tick so several replicas booting together do not all sweep
 * the same due branches in the same second.
 */
const FIRST_TICK_DELAY_MS = 30_000;
const FIRST_TICK_JITTER_MS = 30_000;

export interface GithubBranchRecheckWorkerHandle {
  stop(): void;
  /** One tick, awaited. The scheduler calls it; tests drive it directly. */
  runOnce(): Promise<number>;
}

export interface GithubBranchRecheckWorkerDeps {
  repository: GithubPullRequestsRepository;
  mapping: Pick<GithubPullRequestMappingService, "mapBranch">;
  now?: () => number;
}

/**
 * One sweep pass: select the due branches and re-ask GitHub about each.
 * Returns how many branches were rechecked, which is what the tick logs.
 */
export async function runBranchRecheckPass({
  repository,
  mapping,
  now = () => Date.now(),
}: GithubBranchRecheckWorkerDeps): Promise<number> {
  const due = await repository.findRecheckDue({
    now: new Date(now()),
    activeWithinMs: RECHECK_ACTIVE_WITHIN_MS,
    limit: RECHECK_BATCH_LIMIT,
  });

  for (const row of due) {
    const [owner, name] = row.repositoryFullName.split("/");
    if (!owner || !name) continue;
    // Sequential on purpose: the whole point of the sweep is to be gentle with
    // GitHub, and a batch of fifty is not worth parallelising.
    await mapping.mapBranch({
      organizationId: row.organizationId,
      repositoryHost: row.repositoryHost,
      repositoryOwner: owner,
      repositoryName: name,
      headBranch: row.headBranch,
    });
  }

  return due.length;
}

/**
 * Long-running scheduler around {@link runBranchRecheckPass}. A failed tick is
 * logged and the loop continues: mapping is enrichment, and the next tick picks
 * up exactly the same due branches.
 */
export function startGithubBranchRecheckWorker(
  deps: GithubBranchRecheckWorkerDeps,
): GithubBranchRecheckWorkerHandle {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;

  const runOnce = () => runBranchRecheckPass(deps);

  const tick = async () => {
    if (stopped) return;
    try {
      const rechecked = await runOnce();
      if (rechecked > 0) {
        logger.info({ rechecked }, "branch recheck tick complete");
      }
    } catch (error) {
      logger.error(
        { error },
        "branch recheck tick failed (will retry on next interval)",
      );
    }
    if (!stopped) {
      timer = setTimeout(() => void tick(), RECHECK_TICK_MS);
    }
  };

  timer = setTimeout(
    () => void tick(),
    FIRST_TICK_DELAY_MS + Math.floor(Math.random() * FIRST_TICK_JITTER_MS),
  );

  logger.info("github branch recheck worker started");

  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      logger.info("github branch recheck worker stopped");
    },
    runOnce,
  };
}
