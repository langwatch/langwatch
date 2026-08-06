/**
 * The periodic branch recheck: the half of pull-request linkage that works
 * without any new session activity.
 *
 * A session's branch usually has no pull request when it folds: the work comes
 * first, the pull request follows, sometimes days later. The fold-driven
 * mapping cannot see that: it only runs when a session is folded, and by then
 * the branch may never be touched again. This pass is what closes that gap. It
 * picks up the branches that mapped to nothing, whose backoff has elapsed, and
 * that a reader still cares about, and asks GitHub once more.
 *
 * "Still cares about" is the load-bearing cut. Without it the sweep would grow
 * without bound, asking GitHub daily about every branch any session ever ran on
 * since the connection was made. The same horizon bounds the retention prune,
 * so a branch that falls out of the sweep also stops costing storage.
 *
 * SCHEDULING LIVES ELSEWHERE. This module owns one pass and nothing else; the
 * `githubBranchRecheck` process manager (pipelines/github-maintenance) owns
 * when it runs and fences it across replicas.
 *
 * Spec: specs/coding-agent/pull-request-linkage.feature.
 */
import type { GithubPullRequestMappingService } from "./github-pull-request-mapping.service";
import type { GithubPullRequestsRepository } from "./repositories/github-pull-requests.repository";

/**
 * How long since a reader last asked before a branch drops out of the sweep,
 * and past which its bookkeeping and its pull requests are pruned. A week is
 * generous for a branch someone is still working on and short enough that an
 * abandoned one stops costing GitHub calls and rows.
 */
export const RECHECK_ACTIVE_WITHIN_MS = 7 * 24 * 60 * 60 * 1000;
/** Branches per pass. Each one is a GitHub call, so the pass stays small. */
export const RECHECK_BATCH_LIMIT = 50;

export interface GithubBranchRecheckDeps {
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
}: GithubBranchRecheckDeps): Promise<number> {
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
 * One retention pass: drop the bookkeeping past the activity horizon, and the
 * pull requests it was the only reason to keep.
 */
export async function runBranchRetentionPrune({
  repository,
  now = () => Date.now(),
}: Pick<GithubBranchRecheckDeps, "repository" | "now">): Promise<{
  branchChecks: number;
  pullRequests: number;
}> {
  return await repository.deleteStaleBefore({
    before: new Date(now() - RECHECK_ACTIVE_WITHIN_MS),
  });
}
