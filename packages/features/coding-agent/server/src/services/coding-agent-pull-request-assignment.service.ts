/** Private, deterministic tenure rule for coding-agent pull-request attribution. */
export class CodingAgentPullRequestAssignmentService {
  static create(): CodingAgentPullRequestAssignmentService {
    return new CodingAgentPullRequestAssignmentService();
  }

  private constructor() {}

  assignSessions(input: {
    sessions: readonly AssignableSession[];
    pullRequests: readonly AssignablePullRequest[];
  }): Map<string, number> {
    const byBranch = groupPullRequestsByBranch(input.pullRequests);
    const assignments = new Map<string, number>();
    for (const session of input.sessions) {
      const match = firstAliveAt({
        candidates: byBranch.get(session.headBranch),
        startedAtMs: session.startedAtMs,
      });
      if (match) assignments.set(session.sessionId, match.prNumber);
    }
    return assignments;
  }

  assignDrivingSessions(input: {
    sessions: readonly AssignableDrivingSession[];
    pullRequests: readonly AssignablePullRequest[];
  }): Map<string, number> {
    const byBranch = groupPullRequestsByBranch(input.pullRequests);
    const assignments = new Map<string, number>();
    for (const session of input.sessions) {
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

  branchesOf(session: { gitBranch: string; gitBranches: readonly string[] }): string[] {
    if (session.gitBranches.length > 0) return [...session.gitBranches];
    return session.gitBranch === "" ? [] : [session.gitBranch];
  }
}

export type AssignableSession = {
  sessionId: string;
  startedAtMs: number;
  headBranch: string;
};

export type AssignableDrivingSession = {
  sessionId: string;
  startedAtMs: number;
  headBranches: readonly string[];
};

export type AssignablePullRequest = {
  prNumber: number;
  headBranch: string;
  prCreatedAtMs: number;
  prClosedAtMs: number | null;
  prMergedAtMs: number | null;
};

function firstAliveAt(input: {
  candidates: AssignablePullRequest[] | undefined;
  startedAtMs: number;
}): AssignablePullRequest | undefined {
  return input.candidates?.find(
    (pullRequest) =>
      (pullRequest.prClosedAtMs ??
        pullRequest.prMergedAtMs ??
        Number.POSITIVE_INFINITY) >= input.startedAtMs,
  );
}

function isEarlier(a: AssignablePullRequest, b: AssignablePullRequest): boolean {
  return (
    a.prCreatedAtMs < b.prCreatedAtMs ||
    (a.prCreatedAtMs === b.prCreatedAtMs && a.prNumber < b.prNumber)
  );
}

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
    list.sort((a, b) => a.prCreatedAtMs - b.prCreatedAtMs || a.prNumber - b.prNumber);
  }
  return byBranch;
}
