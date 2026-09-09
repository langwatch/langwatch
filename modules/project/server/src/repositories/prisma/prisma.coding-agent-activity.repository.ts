import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { ProjectNotFoundError } from "@langwatch/project-contract";
import {
  codingAgentActivityStaleBefore,
  type CodingAgentActivityRepository,
} from "../coding-agent-activity.repository.ts";

/**
 * The one model the coding-agent activity seam reads and writes, and nothing
 * else in the client.
 *
 * The composition root already holds a typed `PrismaClient`; naming the model
 * here is what lets it hand that client straight down with no cast at the seam.
 */
export type PrismaCodingAgentActivityDatabase = Pick<PrismaClient, "project">;

/**
 * The project reads and writes the coding-agent session pipeline performs.
 *
 * Three operations, one model, no service graph: resolving the organization a
 * tenant belongs to, and the two throttled activity stamps. The App reaches
 * the identical statements through `ProjectService`, which is composed from
 * this repository's wide sibling plus an authorization service, a topic
 * clustering port, a credentials adapter and both transports' collaborators —
 * none of which any of these three asks anything.
 */
export class PrismaCodingAgentActivityRepository implements CodingAgentActivityRepository {
  private constructor(private readonly prisma: PrismaCodingAgentActivityDatabase) {}

  static create(
    options: Readonly<{ prisma: PrismaCodingAgentActivityDatabase }>,
  ): PrismaCodingAgentActivityRepository {
    return new PrismaCodingAgentActivityRepository(options.prisma);
  }

  /**
   * The organization an active project belongs to.
   *
   * An archived project is not found, which is the same answer
   * `ProjectService.getOrganizationId` gives: it reads through `getWithTeam`,
   * whose query carries `archivedAt: null` and whose miss is this error.
   */
  async getOrganizationId(projectId: string): Promise<string> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId, archivedAt: null },
      select: { team: { select: { organizationId: true } } },
    });
    if (!project) {
      throw new ProjectNotFoundError("Project not found");
    }

    return project.team.organizationId;
  }

  /** Stamps a project as having just seen coding-agent session activity. */
  async touchCodingAgentSessionSeen(input: { projectId: string; at: Date }): Promise<void> {
    await this.prisma.project.updateMany({
      where: {
        id: input.projectId,
        archivedAt: null,
        OR: [
          { lastCodingAgentSessionAt: null },
          { lastCodingAgentSessionAt: { lte: codingAgentActivityStaleBefore(input.at) } },
        ],
      },
      data: { lastCodingAgentSessionAt: input.at },
    });
  }

  /** Stamps a project as having just had a coding-agent pull request mapped. */
  async touchCodingAgentPullRequestSeen(input: { projectId: string; at: Date }): Promise<void> {
    await this.prisma.project.updateMany({
      where: {
        id: input.projectId,
        archivedAt: null,
        OR: [
          { lastCodingAgentPullRequestAt: null },
          { lastCodingAgentPullRequestAt: { lte: codingAgentActivityStaleBefore(input.at) } },
        ],
      },
      data: { lastCodingAgentPullRequestAt: input.at },
    });
  }
}
