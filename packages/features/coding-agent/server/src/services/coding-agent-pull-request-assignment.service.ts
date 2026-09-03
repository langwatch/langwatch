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
    const byBranch = CodingAgentPullRequestAssignmentService.groupByBranch(input.pullRequests);
    const assignments = new Map<string, number>();
    for (const session of input.sessions) {
      const match = CodingAgentPullRequestAssignmentService.firstAliveAt({
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
    const byBranch = CodingAgentPullRequestAssignmentService.groupByBranch(input.pullRequests);
    const assignments = new Map<string, number>();
    for (const session of input.sessions) {
      let winner: AssignablePullRequest | undefined;
      for (const headBranch of session.headBranches) {
        const match = CodingAgentPullRequestAssignmentService.firstAliveAt({
          candidates: byBranch.get(headBranch),
          startedAtMs: session.startedAtMs,
        });
        if (match && (!winner || CodingAgentPullRequestAssignmentService.isEarlier(match, winner)))
          winner = match;
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
  assignDrivingSessionsPerBranch(input: {
    sessions: readonly AssignableDrivingSession[];
    pullRequests: readonly AssignablePullRequest[];
  }): Map<string, ReadonlyMap<string, number>> {
    const byBranch = CodingAgentPullRequestAssignmentService.groupByBranch(input.pullRequests);
    const assignments = new Map<string, ReadonlyMap<string, number>>();

    for (const session of input.sessions) {
      const perBranch = new Map<string, number>();
      for (const headBranch of session.headBranches) {
        const match = CodingAgentPullRequestAssignmentService.firstAliveAt({
          candidates: byBranch.get(headBranch),
          startedAtMs: session.startedAtMs,
        });
        if (match) perBranch.set(headBranch, match.prNumber);
      }
      if (perBranch.size > 0) assignments.set(session.sessionId, perBranch);
    }

    return assignments;
  }

  branchesOf(session: { gitBranch: string; gitBranches: readonly string[] }): string[] {
    if (session.gitBranches.length > 0) return [...session.gitBranches];
    return session.gitBranch === "" ? [] : [session.gitBranch];
  }

  private static firstAliveAt(input: {
    candidates: AssignablePullRequest[] | undefined;
    startedAtMs: number;
  }): AssignablePullRequest | undefined {
    return input.candidates?.find(
      (pullRequest) =>
        (pullRequest.prClosedAtMs ?? pullRequest.prMergedAtMs ?? Number.POSITIVE_INFINITY) >=
        input.startedAtMs,
    );
  }

  private static isEarlier(a: AssignablePullRequest, b: AssignablePullRequest): boolean {
    return (
      a.prCreatedAtMs < b.prCreatedAtMs ||
      (a.prCreatedAtMs === b.prCreatedAtMs && a.prNumber < b.prNumber)
    );
  }

  private static groupByBranch(
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
