import type { CodingAgentSession } from "@langwatch/coding-agent-contract";
import type { GithubPullRequest, GithubService } from "@langwatch/github-contract";
import type { ProjectService } from "@langwatch/project-contract";
import { CodingAgentPullRequestAssignmentService } from "./coding-agent-pull-request-assignment.service";

/** Private GitHub enrichment collaborator for the bounded session-list view. */
export class CodingAgentSessionListPullRequestService {
  static create(options: {
    github: GithubService;
    projects: ProjectService;
    assignments: CodingAgentPullRequestAssignmentService;
  }): CodingAgentSessionListPullRequestService {
    return new CodingAgentSessionListPullRequestService(options);
  }

  private constructor(
    private readonly dependencies: {
      github: GithubService;
      projects: ProjectService;
      assignments: CodingAgentPullRequestAssignmentService;
    },
  ) {}

  async findForProject(input: {
    projectId: string;
    sessions: CodingAgentSession[];
  }): Promise<Map<string, Array<{ number: number; url: string; title: string }>>> {
    const drives = this.listBranchDrives(input.sessions);
    if (drives.length === 0) return new Map();
    try {
      const project = await this.dependencies.projects.tryGetWithTeam(input.projectId);
      if (project === null) return new Map();
      const candidates = await this.dependencies.github.findForBranches({
        organizationId: project.team.organizationId,
        keys: this.uniqueBranchKeys(drives),
      });
      return this.linkedPullRequests(drives, candidates);
    } catch {
      return new Map();
    }
  }

  private listBranchDrives(sessions: readonly CodingAgentSession[]): ListBranchDrive[] {
    const drives: ListBranchDrive[] = [];
    for (const session of sessions) {
      if (!session.repositoryOwner || !session.repositoryName) continue;
      for (const headBranch of this.dependencies.assignments.branchesOf(session)) {
        drives.push({
          sessionId: session.sessionId,
          startedAtMs: session.startedAtMs,
          repositoryHost: this.dependencies.github.normalizeRepositoryHost(
            session.repositoryHost,
          ),
          repositoryFullName:
            `${session.repositoryOwner}/${session.repositoryName}`.toLowerCase(),
          headBranch,
        });
      }
    }
    return drives;
  }

  private uniqueBranchKeys(
    drives: readonly ListBranchDrive[],
  ): Array<{ repositoryHost: string; repositoryFullName: string; headBranch: string }> {
    const keys = new Map<
      string,
      { repositoryHost: string; repositoryFullName: string; headBranch: string }
    >();
    for (const drive of drives) {
      keys.set(
        `${drive.repositoryHost} ${drive.repositoryFullName} ${drive.headBranch}`,
        {
          repositoryHost: drive.repositoryHost,
          repositoryFullName: drive.repositoryFullName,
          headBranch: drive.headBranch,
        },
      );
    }
    return [...keys.values()];
  }

  private linkedPullRequests(
    drives: readonly ListBranchDrive[],
    candidates: readonly GithubPullRequest[],
  ): Map<string, Array<{ number: number; url: string; title: string }>> {
    const found = new Map<
      string,
      Map<number, { number: number; url: string; title: string }>
    >();
    const byRepository = new Map<string, ListBranchDrive[]>();
    for (const drive of drives) {
      const key = `${drive.repositoryHost.toLowerCase()} ${drive.repositoryFullName.toLowerCase()}`;
      const bucket = byRepository.get(key) ?? [];
      bucket.push(drive);
      byRepository.set(key, bucket);
    }
    for (const [bucket, bucketDrives] of byRepository) {
      const bucketCandidates = candidates.filter(
        (candidate) =>
          `${candidate.repositoryHost.toLowerCase()} ${candidate.repositoryFullName.toLowerCase()}` ===
          bucket,
      );
      const assignments = this.dependencies.assignments.assignSessions({
        sessions: bucketDrives.map((drive) => ({
          sessionId: `${drive.sessionId}\0${drive.headBranch}`,
          startedAtMs: drive.startedAtMs,
          headBranch: drive.headBranch,
        })),
        pullRequests: bucketCandidates.map((pullRequest) => ({
          prNumber: pullRequest.prNumber,
          headBranch: pullRequest.headBranch,
          prCreatedAtMs: pullRequest.prCreatedAt.getTime(),
          prClosedAtMs: pullRequest.prClosedAt?.getTime() ?? null,
          prMergedAtMs: pullRequest.prMergedAt?.getTime() ?? null,
        })),
      });
      for (const drive of bucketDrives) {
        const candidate = bucketCandidates.find(
          (row) =>
            row.prNumber === assignments.get(`${drive.sessionId}\0${drive.headBranch}`),
        );
        if (!candidate) continue;
        const rows = found.get(drive.sessionId) ?? new Map();
        rows.set(candidate.prNumber, {
          number: candidate.prNumber,
          url: candidate.htmlUrl,
          title: candidate.title,
        });
        found.set(drive.sessionId, rows);
      }
    }
    return new Map(
      [...found].map(([sessionId, rows]) => [
        sessionId,
        [...rows.values()].sort((a, b) => a.number - b.number),
      ]),
    );
  }
}

type ListBranchDrive = {
  sessionId: string;
  startedAtMs: number;
  repositoryHost: string;
  repositoryFullName: string;
  headBranch: string;
};
