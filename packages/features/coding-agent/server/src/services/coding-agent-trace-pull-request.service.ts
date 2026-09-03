import type {
  CodingAgentTracePullRequestInput,
  CodingAgentTracePullRequestLink,
  CodingAgentTraceSessionCandidate,
} from "@langwatch/coding-agent-contract";
import type { GithubPullRequest, GithubService } from "@langwatch/github-contract";
import { CodingAgentPullRequestAssignmentService } from "./coding-agent-pull-request-assignment.service";

type LinkableSession = CodingAgentTraceSessionCandidate & {
  repositoryOwner: string;
  repositoryName: string;
  gitBranch: string;
};

/** Private collaborator for attaching trace sessions to their branch's pull request. */
export class CodingAgentTracePullRequestService {
  static create(options: {
    github: GithubService;
    assignments: CodingAgentPullRequestAssignmentService;
  }): CodingAgentTracePullRequestService {
    return new CodingAgentTracePullRequestService(options);
  }

  private constructor(
    private readonly dependencies: {
      github: GithubService;
      assignments: CodingAgentPullRequestAssignmentService;
    },
  ) {}

  async link(input: CodingAgentTracePullRequestInput): Promise<CodingAgentTracePullRequestLink[]> {
    const sessions = input.sessions.filter(
      (session): session is LinkableSession =>
        session.repositoryOwner !== null &&
        session.repositoryName !== null &&
        session.gitBranch !== null,
    );
    if (sessions.length === 0) {
      return [];
    }

    const pullRequests = await this.dependencies.github.findForBranches({
      organizationId: input.organizationId,
      keys: this.branchKeys(sessions),
    });

    return this.links(sessions, pullRequests);
  }

  private branchKeys(sessions: readonly LinkableSession[]) {
    const keys = new Map<
      string,
      { repositoryHost: string; repositoryFullName: string; headBranch: string }
    >();

    for (const session of sessions) {
      const key = this.branchKey(session);
      keys.set(`${this.repositoryBucket(key)} ${key.headBranch}`, key);
    }

    return [...keys.values()];
  }

  private links(
    sessions: readonly LinkableSession[],
    pullRequests: readonly GithubPullRequest[],
  ): CodingAgentTracePullRequestLink[] {
    const links: CodingAgentTracePullRequestLink[] = [];

    for (const [bucket, bucketSessions] of this.sessionsByRepository(sessions)) {
      const candidates = pullRequests.filter(
        (pullRequest) => this.repositoryBucket(pullRequest) === bucket,
      );
      const assignments = this.dependencies.assignments.assignSessions({
        sessions: bucketSessions.map((session) => ({
          sessionId: session.sessionId,
          startedAtMs: session.startedAtMs,
          headBranch: session.gitBranch,
        })),
        pullRequests: candidates.map((pullRequest) => ({
          prNumber: pullRequest.prNumber,
          headBranch: pullRequest.headBranch,
          prCreatedAtMs: pullRequest.prCreatedAt.getTime(),
          prClosedAtMs: pullRequest.prClosedAt?.getTime() ?? null,
          prMergedAtMs: pullRequest.prMergedAt?.getTime() ?? null,
        })),
      });

      for (const session of bucketSessions) {
        const prNumber = assignments.get(session.sessionId);
        const pullRequest = candidates.find((candidate) => candidate.prNumber === prNumber);
        if (!pullRequest) {
          continue;
        }

        links.push({
          sessionId: session.sessionId,
          pullRequest: {
            number: pullRequest.prNumber,
            htmlUrl: pullRequest.htmlUrl,
            title: pullRequest.title,
          },
        });
      }
    }

    return links;
  }

  private sessionsByRepository(sessions: readonly LinkableSession[]) {
    const buckets = new Map<string, LinkableSession[]>();

    for (const session of sessions) {
      const bucket = this.repositoryBucket(this.branchKey(session));
      const entries = buckets.get(bucket) ?? [];
      entries.push(session);
      buckets.set(bucket, entries);
    }

    return buckets;
  }

  private branchKey(session: LinkableSession) {
    return {
      repositoryHost: this.dependencies.github.normalizeRepositoryHost(
        session.repositoryHost ?? "",
      ),
      repositoryFullName: `${session.repositoryOwner}/${session.repositoryName}`.toLowerCase(),
      headBranch: session.gitBranch,
    };
  }

  private repositoryBucket(input: { repositoryHost: string; repositoryFullName: string }): string {
    return `${input.repositoryHost.toLowerCase()} ${input.repositoryFullName.toLowerCase()}`;
  }
}
