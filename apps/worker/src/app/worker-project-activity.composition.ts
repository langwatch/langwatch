import type { CodingAgentProjectActivityPort } from "@langwatch/coding-agent-server";
import type { GithubProjectActivityPort } from "@langwatch/github-server";
import { toDate, type Instant } from "@langwatch/time";

type WorkerProjectActivitySource = {
  getOrganizationId(projectId: string): Promise<string>;
  touchCodingAgentPullRequestSeen(input: { projectId: string; at: Date }): Promise<void>;
  touchCodingAgentSessionSeen(input: { projectId: string; at: Date }): Promise<void>;
};

/**
 * Adapts the shared Prisma activity repository to the two Instant seams the
 * coding-agent and GitHub modules declare. The repository stamps Prisma
 * columns, which take a `Date`, so the conversion happens once, here.
 */
export class WorkerProjectActivityAdapter
  implements GithubProjectActivityPort, CodingAgentProjectActivityPort
{
  static create(activity: WorkerProjectActivitySource): WorkerProjectActivityAdapter {
    return new WorkerProjectActivityAdapter(activity);
  }

  private constructor(private readonly activity: WorkerProjectActivitySource) {}

  getOrganizationId(projectId: string): Promise<string> {
    return this.activity.getOrganizationId(projectId);
  }

  touchCodingAgentPullRequestSeen(input: { projectId: string; at: Instant }): Promise<void> {
    return this.activity.touchCodingAgentPullRequestSeen({
      projectId: input.projectId,
      at: toDate(input.at),
    });
  }

  touchCodingAgentSessionSeen(input: { projectId: string; at: Instant }): Promise<void> {
    return this.activity.touchCodingAgentSessionSeen({
      projectId: input.projectId,
      at: toDate(input.at),
    });
  }
}
