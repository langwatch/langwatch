/**
 * The tenure rule: which pull request a coding-agent session belongs to.
 *
 * A branch can host several pull requests over its life (open, merge, reuse the
 * name, open another), and a session routinely runs BEFORE the pull request it
 * produced was opened. Attribution therefore cannot be "the pull request that
 * existed when the session ran"; it is "the first pull request on that branch
 * whose life had not ended yet when the session started".
 *
 * A session also drives more than one branch over its life, so the rule is
 * asked per branch and the answers are collected back onto the session. What
 * the caller does with several answers depends on what it is counting:
 * `assignDrivingSessionsToPullRequests` keeps one, because token totals cannot
 * be divided; the sessions list keeps all of them, because a list of what a
 * session touched divides nothing.
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

/** The same facts for a session that drove more than one branch. */
export interface AssignableDrivingSession {
  sessionId: string;
  startedAtMs: number;
  headBranches: readonly string[];
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
    const match = firstAliveAt({
      candidates: byBranch.get(session.headBranch),
      startedAtMs: session.startedAtMs,
    });
    if (match) assignments.set(session.sessionId, match.prNumber);
  }

  return assignments;
}

/**
 * Assign each session to at most one pull request, reading EVERY branch it
 * drove rather than only the one it ended on.
 *
 * A session routinely drives several branches: you land one change, it merges,
 * you start the next. Reading the last branch alone charges the whole session
 * to the last pull request and leaves the one it opened first reading as free.
 *
 * At most one, because this rule prices what has no finer record: the tokens a
 * session spent with NO stamped working context — history from before the
 * stamp existed, and sessions that never declared where they were. Giving
 * every pull request that same full total would make a repository's pull
 * requests sum to more than was ever spent, which on a page about cost is the
 * one error worth refusing. Stamped tokens split per branch through
 * `assignDrivingSessionsToPullRequestsPerBranch` instead, and the sessions
 * list is where all of a session's pull requests are shown.
 *
 * The winner is the earliest-created pull request the rule matched, tie-broken
 * by number. A session is anchored on where it STARTED, so the pull request it
 * opened first is the one it belongs to, and the choice reads the same however
 * its branches arrived.
 */
export function assignDrivingSessionsToPullRequests({
  sessions,
  pullRequests,
}: {
  sessions: readonly AssignableDrivingSession[];
  pullRequests: readonly AssignablePullRequest[];
}): Map<string, number> {
  const byBranch = groupPullRequestsByBranch(pullRequests);
  const assignments = new Map<string, number>();

  for (const session of sessions) {
    let winner: AssignablePullRequest | undefined;
    for (const headBranch of session.headBranches) {
      const match = firstAliveAt({
        candidates: byBranch.get(headBranch),
        startedAtMs: session.startedAtMs,
      });
      if (match && (!winner || isEarlier(match, winner))) winner = match;
    }
    if (winner) assignments.set(session.sessionId, winner.prNumber);
  }

  return assignments;
}

/**
 * The tenure rule answered PER BRANCH: for each branch the session drove, the
 * pull request its work on that branch belongs to. This is what stamped fact
 * rows attribute through — tokens stamped with branch B go to B's winner — so
 * one session's cost lands on every pull request it drove, each by the work it
 * did there. A branch with no pull request alive in the session's era is
 * simply absent from the map.
 */
export function assignDrivingSessionsToPullRequestsPerBranch({
  sessions,
  pullRequests,
}: {
  sessions: readonly AssignableDrivingSession[];
  pullRequests: readonly AssignablePullRequest[];
}): Map<string, ReadonlyMap<string, number>> {
  const byBranch = groupPullRequestsByBranch(pullRequests);
  const assignments = new Map<string, ReadonlyMap<string, number>>();

  for (const session of sessions) {
    const perBranch = new Map<string, number>();
    for (const headBranch of session.headBranches) {
      const match = firstAliveAt({
        candidates: byBranch.get(headBranch),
        startedAtMs: session.startedAtMs,
      });
      if (match) perBranch.set(headBranch, match.prNumber);
    }
    if (perBranch.size > 0) assignments.set(session.sessionId, perBranch);
  }

  return assignments;
}

/**
 * Every branch a session drove, first seen first.
 *
 * `gitBranches` (migration 00077) is the whole history. A row folded before
 * that column existed carries only `gitBranch`, so it falls back to that one:
 * the session did drive it, and answering nothing would unlink every session in
 * the dormant population.
 */
export function branchesOf(session: {
  gitBranch: string;
  gitBranches: readonly string[];
}): string[] {
  if (session.gitBranches.length > 0) return [...session.gitBranches];
  return session.gitBranch ? [session.gitBranch] : [];
}

/** The branch's first pull request still alive when the session started. */
function firstAliveAt({
  candidates,
  startedAtMs,
}: {
  candidates: AssignablePullRequest[] | undefined;
  startedAtMs: number;
}): AssignablePullRequest | undefined {
  return candidates?.find(
    (pullRequest) => endOfLifeMs(pullRequest) >= startedAtMs,
  );
}

/** Creation order, with the number breaking a same-instant tie. */
function isEarlier(
  a: AssignablePullRequest,
  b: AssignablePullRequest,
): boolean {
  return (
    a.prCreatedAtMs < b.prCreatedAtMs ||
    (a.prCreatedAtMs === b.prCreatedAtMs && a.prNumber < b.prNumber)
  );
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
