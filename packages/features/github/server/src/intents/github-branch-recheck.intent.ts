/**
 * The periodic branch recheck: the half of pull-request linkage that works
 * without any new session activity.
 *
 * A session's branch usually has no pull request when it folds: the work comes
 * first, the pull request follows, sometimes days later. The fold-driven
 * mapping cannot see that: it only runs when a session is folded, and by then
 * the branch may never be touched again. This pass is what closes that gap. It
 * picks up the branches that mapped to nothing, whose backoff has elapsed, and
 * that a session has run on recently, and asks GitHub once more.
 *
 * That last cut is what bounds the sweep. Without it, every branch any session
 * ever ran on since the connection was made is asked about daily, for good. The
 * cut works only because the sweep does not write the column it selects on: a
 * pass runs with `origin: "sweep"`, which leaves `lastRequestedAt` alone, so a
 * branch with no new folds ages out of the sweep on its own. The same horizon
 * bounds the retention prune, so a branch that falls out of the sweep also
 * stops costing a bookkeeping row. Its pull requests are kept.
 *
 * SCHEDULING LIVES ELSEWHERE. This module owns one pass and nothing else; the
 * `githubBranchRecheck` process manager (pipelines/github-maintenance) owns
 * when it runs and fences it across replicas.
 *
 * Spec: specs/coding-agent/pull-request-linkage.feature.
 */
import type { GithubPullRequestMappingService } from "../services/github-pull-request-mapping.service";
import type { GithubPullRequestsRepository } from "../repositories/github-pull-requests.repository";

/**
 * How long since a session last folded on a branch before it drops out of the
 * sweep, and past which its bookkeeping is pruned. A week is generous for a
 * branch someone is still working on and short enough that an abandoned one
 * stops costing GitHub calls and rows.
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
      // The sweep asks on its own account, so the answer must not refresh the
      // demand the sweep selected this branch by.
      origin: "sweep",
    });
  }

  return due.length;
}

/**
 * One retention pass: drop the branch bookkeeping past the activity horizon.
 * The pull requests it found stay.
 */
export async function runBranchRetentionPrune({
  repository,
  now = () => Date.now(),
}: Pick<GithubBranchRecheckDeps, "repository" | "now">): Promise<{
  branchChecks: number;
}> {
  return await repository.deleteStaleBefore({
    before: new Date(now() - RECHECK_ACTIVE_WITHIN_MS),
  });
}
