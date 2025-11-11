import type { PrismaClient } from "@prisma/client";

export interface ProjectInfo {
  id: string;
  name: string;
}

/**
 * Repository for project data access
 * Single Responsibility: Query project data
 */
export class ProjectRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Get all projects for an organization
   */
  async getProjectsByOrganization(
    organizationId: string,
  ): Promise<ProjectInfo[]> {
    return this.prisma.project.findMany({
      where: {
        team: { organizationId },
      },
      select: {
        id: true,
        name: true,
      },
      orderBy: {
        name: "asc",
      },
    });
  }
}

