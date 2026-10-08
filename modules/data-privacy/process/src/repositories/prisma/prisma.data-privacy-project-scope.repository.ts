import type { PrismaClient } from "@langwatch/prisma-client/generated";

import type {
  DataPrivacyProjectScope,
  DataPrivacyProjectScopeRepository,
} from "../data-privacy-project-scope.repository.ts";

/** Only the shared delegate this reader touches; it claims no table (R40). */
type DataPrivacyProjectScopeDatabase = Pick<PrismaClient, "project">;

/** Project's `Project` row and its team's organisation, through their shares, in one read. */
export class PrismaDataPrivacyProjectScopeRepository implements DataPrivacyProjectScopeRepository {
  static create(prisma: DataPrivacyProjectScopeDatabase): PrismaDataPrivacyProjectScopeRepository {
    return new PrismaDataPrivacyProjectScopeRepository(prisma);
  }

  private constructor(private readonly prisma: DataPrivacyProjectScopeDatabase) {}

  async find({ projectId }: { projectId: string }): Promise<DataPrivacyProjectScope | null> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: {
        teamId: true,
        isPersonal: true,
        departmentId: true,
        archivedAt: true,
        team: { select: { organizationId: true } },
      },
    });
    if (!project?.team) return null;

    return {
      projectId,
      organizationId: project.team.organizationId,
      teamId: project.teamId,
      isPersonal: project.isPersonal,
      departmentId: project.departmentId,
      archived: project.archivedAt !== null,
    };
  }
}
