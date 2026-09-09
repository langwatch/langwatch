import type { GithubProjectActivityPort } from "@langwatch/github-server";
import { toDate, type Instant } from "@langwatch/time";
type WorkerGithubActivitySource = {
  getOrganizationId(projectId: string): Promise<string>;
  touchCodingAgentPullRequestSeen(input: { projectId: string; at: Date }): Promise<void>;
};

/** Adapts the shared Prisma activity repository to GitHub's Instant seam. */
export class WorkerGithubProjectActivityAdapter implements GithubProjectActivityPort {
  static create(activity: WorkerGithubActivitySource): WorkerGithubProjectActivityAdapter {
    return new WorkerGithubProjectActivityAdapter(activity);
  }

  private constructor(private readonly activity: WorkerGithubActivitySource) {}

  getOrganizationId(projectId: string): Promise<string> {
    return this.activity.getOrganizationId(projectId);
  }

  touchCodingAgentPullRequestSeen(input: { projectId: string; at: Instant }): Promise<void> {
    return this.activity.touchCodingAgentPullRequestSeen({
      projectId: input.projectId,
      at: toDate(input.at),
    });
  }
}
