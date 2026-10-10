import type { PrismaClient } from "@langwatch/prisma-client/generated";

import type {
  DataPrivacyProjectScope,
  DataPrivacyProjectScopeRepository,
} from "../data-privacy-project-scope.repository.ts";

/** Only the shared delegate this reader touches; it claims no table (R40). */
type DataPrivacyProjectScopeDatabase = Pick<PrismaClient, "project" | "organizationUser">;

/** Project's row, its team's organisation and a personal owner's membership, through shares. */
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
        ownerUserId: true,
        team: { select: { organizationId: true } },
      },
    });
    if (!project?.team) return null;

    const organizationId = project.team.organizationId;
    const departmentId = project.isPersonal
      ? await this.findOwnerDepartmentId({ ownerUserId: project.ownerUserId, organizationId })
      : project.departmentId;

    return {
      projectId,
      organizationId,
      teamId: project.teamId,
      isPersonal: project.isPersonal,
      departmentId,
    };
  }

  private async findOwnerDepartmentId({
    ownerUserId,
    organizationId,
  }: {
    ownerUserId: string | null;
    organizationId: string;
  }): Promise<string | null> {
    if (!ownerUserId) return null;
    const membership = await this.prisma.organizationUser.findUnique({
      where: { userId_organizationId: { userId: ownerUserId, organizationId } },
      select: { departmentId: true },
    });
    return membership?.departmentId ?? null;
  }
}
