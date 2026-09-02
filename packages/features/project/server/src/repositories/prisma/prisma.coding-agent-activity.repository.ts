import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { ProjectNotFoundError } from "@langwatch/project-contract";

/**
 * The one model the coding-agent activity seam reads and writes, and nothing
 * else in the client.
 *
 * The composition root already holds a typed `PrismaClient`; naming the model
 * here is what lets it hand that client straight down with no cast at the seam.
 */
export type PrismaCodingAgentActivityDatabase = Pick<PrismaClient, "project">;

/**
 * How stale a project's recorded coding-agent activity has to be before the
 * next fold writes it again.
 *
 * Frozen twin: `ProjectService`'s `CODING_AGENT_ACTIVITY_TOUCH_MS` is the same
 * hour, and both graphs write the same two columns of the same rows. A shorter
 * window on either side turns a busy fleet's session folds into Postgres
 * traffic; a longer one leaves the settings surfaces reading an activity date
 * that the other graph has already moved.
 */
const CODING_AGENT_ACTIVITY_TOUCH_MS = 60 * 60 * 1000;

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
export class PrismaCodingAgentActivityRepository {
  static create(
    database: PrismaCodingAgentActivityDatabase,
  ): PrismaCodingAgentActivityRepository {
    return new PrismaCodingAgentActivityRepository(database);
  }

  private constructor(private readonly prisma: PrismaCodingAgentActivityDatabase) {}

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
          { lastCodingAgentSessionAt: { lte: staleBefore(input.at) } },
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
          { lastCodingAgentPullRequestAt: { lte: staleBefore(input.at) } },
        ],
      },
      data: { lastCodingAgentPullRequestAt: input.at },
    });
  }
}

function staleBefore(at: Date): Date {
  return new Date(at.getTime() - CODING_AGENT_ACTIVITY_TOUCH_MS);
}
