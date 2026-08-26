import type { GithubService } from "@langwatch/github-contract";
import { CodingAgentPullRequestAssignmentService } from "../services/coding-agent-pull-request-assignment.service";

export type CodingAgentTracePullRequest = {
  repositoryHost: string;
  repositoryFullName: string;
  headBranch: string;
  prNumber: number;
  htmlUrl: string;
  title: string;
  prCreatedAt: Date;
  prClosedAt: Date | null;
  prMergedAt: Date | null;
};

export type CodingAgentTracePullRequestBranchKey = {
  repositoryHost: string;
  repositoryFullName: string;
  headBranch: string;
};

export type CodingAgentTraceLinkableSession = {
  conversationId: string;
  startedAtMs: number;
  codingAgent: {
    repositoryHost: string | null;
    repositoryOwner: string | null;
    repositoryName: string | null;
    gitBranch: string | null;
    pullRequest: { number: number; htmlUrl: string; title: string } | null;
  };
  repositoryHost: string | null;
  repositoryOwner: string;
  repositoryName: string;
  gitBranch: string;
};

/** Named adapter that applies Coding Agent tenure to a trace-session page. */
export class CodingAgentTracePullRequestAdapter {
  static create(options: { github: GithubService }): CodingAgentTracePullRequestAdapter {
    return new CodingAgentTracePullRequestAdapter(
      options.github,
      CodingAgentPullRequestAssignmentService.create(),
    );
  }

  private constructor(
    private readonly github: GithubService,
    private readonly assignments: CodingAgentPullRequestAssignmentService,
  ) {}

  linkableSessions(input: {
    rows: Array<{ conversationId: string; startedAtMs: number }>;
    enrichments: Array<{
      repositoryHost: string | null;
      repositoryOwner: string | null;
      repositoryName: string | null;
      gitBranch: string | null;
      pullRequest: { number: number; htmlUrl: string; title: string } | null;
    } | null>;
  }): CodingAgentTraceLinkableSession[] {
    const linkable: CodingAgentTraceLinkableSession[] = [];
    input.rows.forEach((row, index) => {
      const codingAgent = input.enrichments[index] ?? null;
      if (!codingAgent?.repositoryOwner) return;
      if (!codingAgent.repositoryName || !codingAgent.gitBranch) return;
      linkable.push({
        conversationId: row.conversationId,
        startedAtMs: row.startedAtMs,
        codingAgent,
        repositoryHost: codingAgent.repositoryHost,
        repositoryOwner: codingAgent.repositoryOwner,
        repositoryName: codingAgent.repositoryName,
        gitBranch: codingAgent.gitBranch,
      });
    });
    return linkable;
  }

  branchKeys(
    sessions: readonly CodingAgentTraceLinkableSession[],
  ): CodingAgentTracePullRequestBranchKey[] {
    const keys = new Map<string, CodingAgentTracePullRequestBranchKey>();
    for (const session of sessions) {
      const key = this.branchKey(session);
      keys.set(`${this.repositoryBucket(key)} ${key.headBranch}`, key);
    }
    return [...keys.values()];
  }

  link(input: {
    sessions: readonly CodingAgentTraceLinkableSession[];
    pullRequests: readonly CodingAgentTracePullRequest[];
  }): void {
    const byRepository = new Map<string, CodingAgentTraceLinkableSession[]>();
    for (const session of input.sessions) {
      const bucket = this.repositoryBucket(this.branchKey(session));
      const sessions = byRepository.get(bucket) ?? [];
      sessions.push(session);
      byRepository.set(bucket, sessions);
    }
    for (const [bucket, sessions] of byRepository) {
      const pullRequests = input.pullRequests.filter(
        (pullRequest) => this.repositoryBucket(pullRequest) === bucket,
      );
      if (pullRequests.length === 0) continue;
      const assigned = this.assignments.assignSessions({
        sessions: sessions.map((session) => ({
          sessionId: session.conversationId,
          startedAtMs: session.startedAtMs,
          headBranch: session.gitBranch,
        })),
        pullRequests: pullRequests.map((pullRequest) => ({
          prNumber: pullRequest.prNumber,
          headBranch: pullRequest.headBranch,
          prCreatedAtMs: pullRequest.prCreatedAt.getTime(),
          prClosedAtMs: pullRequest.prClosedAt?.getTime() ?? null,
          prMergedAtMs: pullRequest.prMergedAt?.getTime() ?? null,
        })),
      });
      for (const session of sessions) {
        const prNumber = assigned.get(session.conversationId);
        const match = pullRequests.find(
          (pullRequest) => pullRequest.prNumber === prNumber,
        );
        if (!match) continue;
        session.codingAgent.pullRequest = {
          number: match.prNumber,
          htmlUrl: match.htmlUrl,
          title: match.title,
        };
      }
    }
  }

  private branchKey(
    session: CodingAgentTraceLinkableSession,
  ): CodingAgentTracePullRequestBranchKey {
    return {
      repositoryHost: this.github.normalizeRepositoryHost(session.repositoryHost ?? ""),
      repositoryFullName:
        `${session.repositoryOwner}/${session.repositoryName}`.toLowerCase(),
      headBranch: session.gitBranch,
    };
  }

  private repositoryBucket(key: {
    repositoryHost: string;
    repositoryFullName: string;
  }): string {
    return `${key.repositoryHost.toLowerCase()} ${key.repositoryFullName.toLowerCase()}`;
  }
}
