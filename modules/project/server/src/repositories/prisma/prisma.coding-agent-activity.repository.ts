import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { ProjectNotFoundError } from "@langwatch/project-contract";
import {
  codingAgentActivityStaleBefore,
  type CodingAgentActivityRepository,
} from "../coding-agent-activity.repository.ts";

/**
 * The one model the coding-agent activity seam reads and writes. Naming it
 * here is what lets the composition root hand its typed `PrismaClient`
 * straight down with no cast at the seam.
 */
export type PrismaCodingAgentActivityDatabase = Pick<PrismaClient, "project">;

/**
 * Three operations on one model: resolve organization and timestamp activity.
 * App uses ProjectService layer; this repo has no service dependencies.
 */
export class PrismaCodingAgentActivityRepository implements CodingAgentActivityRepository {
  private constructor(private readonly prisma: PrismaCodingAgentActivityDatabase) {}

  static create(
    options: Readonly<{ prisma: PrismaCodingAgentActivityDatabase }>,
  ): PrismaCodingAgentActivityRepository {
    return new PrismaCodingAgentActivityRepository(options.prisma);
  }

  /**
   * The organization an active project belongs to — the same answer as
   * `ProjectService.getOrganizationId` (`getWithTeam`, `archivedAt: null`);
   * an archived project misses with this error.
   */
  async findOrganizationId(projectId: string): Promise<string> {
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
