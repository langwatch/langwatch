/**
 * Repository for Project data access.
 * Single Responsibility: Database operations for projects.
 */

import type { PrismaClient } from "@prisma/client";

export class ProjectRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Resolves the organizationId for a project by traversing project -> team -> organization.
   * Returns null if the project does not exist or has no associated organization.
   */
  async getOrganizationId(params: {
    projectId: string;
  }): Promise<string | null> {
    const project = await this.prisma.project.findUnique({
      where: { id: params.projectId },
      include: { team: { include: { organization: true } } },
    });
    return project?.team?.organizationId ?? null;
  }
}
