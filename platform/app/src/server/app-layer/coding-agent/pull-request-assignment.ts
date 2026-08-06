/**
 * The tenure rule: which pull request a coding-agent session belongs to.
 *
 * A branch can host several pull requests over its life (open, merge, reuse the
 * name, open another), and a session routinely runs BEFORE the pull request it
 * produced was opened. Attribution therefore cannot be "the pull request that
 * existed when the session ran"; it is "the first pull request on that branch
 * whose life had not ended yet when the session started".
 *
 * Pure, synchronous, and total: it decides from timestamps alone so the same
 * rule answers the same way in the usage rollup, in the sessions lens, and in a
 * test. Nothing here reads a store.
 *
 * Spec: specs/coding-agent/pull-request-linkage.feature.
 */

/** The session facts the rule needs: when it started, on which branch. */
export interface AssignableSession {
  sessionId: string;
  startedAtMs: number;
  headBranch: string;
}

/** The pull-request facts the rule needs: its branch and its life span. */
export interface AssignablePullRequest {
  prNumber: number;
  headBranch: string;
  prCreatedAtMs: number;
  /** Epoch ms, or null while the pull request is still open. */
  prClosedAtMs: number | null;
  /** Epoch ms, or null while the pull request is unmerged. */
  prMergedAtMs: number | null;
}

/**
 * The instant a pull request stopped being the branch's live pull request.
 * An open one never has: it owns the branch's present, so every session on that
 * branch from its era onwards belongs to it.
 *
 * `prClosedAt` is preferred over `prMergedAt` because GitHub sets both on a
 * merge and they agree; a closed-unmerged pull request has only the former.
 */
function endOfLifeMs(pullRequest: AssignablePullRequest): number {
  return (
    pullRequest.prClosedAtMs ??
    pullRequest.prMergedAtMs ??
    Number.POSITIVE_INFINITY
  );
}

/**
 * Assign each session to at most one pull request on its own branch.
 *
 * Per branch, pull requests are ordered by creation and a session takes the
 * FIRST one that was still alive at the session's start. Two consequences are
 * deliberate:
 *
 *   - A session that ran before ANY pull request existed still attaches to the
 *     earliest one, because that one's end of life is after the session start.
 *     That is the common case: the work comes first, the pull request follows.
 *   - A session that ran after the last pull request on the branch was closed
 *     attaches to nothing. It is a new era of the branch whose pull request has
 *     not been opened (or mapped) yet, and guessing the closed one would price
 *     someone else's work into a merged pull request.
 *
 * Returns a map from session id to the assigned `prNumber`. Sessions with no
 * pull request are simply absent, so the caller reads absence rather than a
 * sentinel.
 */
export function assignSessionsToPullRequests({
  sessions,
  pullRequests,
}: {
  sessions: readonly AssignableSession[];
  pullRequests: readonly AssignablePullRequest[];
}): Map<string, number> {
  const byBranch = groupPullRequestsByBranch(pullRequests);
  const assignments = new Map<string, number>();

  for (const session of sessions) {
    const candidates = byBranch.get(session.headBranch);
    if (!candidates) continue;
    const match = candidates.find(
      (pullRequest) => endOfLifeMs(pullRequest) >= session.startedAtMs,
    );
    if (match) assignments.set(session.sessionId, match.prNumber);
  }

  return assignments;
}

/**
 * Branch to its pull requests, oldest first. The number breaks a creation-time
 * tie so two pull requests opened in the same second still order the same way
 * on every call, which is what keeps "at most one" stable across reads.
 */
function groupPullRequestsByBranch(
  pullRequests: readonly AssignablePullRequest[],
): Map<string, AssignablePullRequest[]> {
  const byBranch = new Map<string, AssignablePullRequest[]>();
  for (const pullRequest of pullRequests) {
    const list = byBranch.get(pullRequest.headBranch) ?? [];
    list.push(pullRequest);
    byBranch.set(pullRequest.headBranch, list);
  }
  for (const list of byBranch.values()) {
    list.sort(
      (a, b) => a.prCreatedAtMs - b.prCreatedAtMs || a.prNumber - b.prNumber,
    );
  }
  return byBranch;
}
