import type { PrismaClient } from "@langwatch/prisma-client/generated";

import type {
  DataRetentionProjectPlacement,
  DataRetentionProjectScopeRepository,
} from "../data-retention-project-scope.repository.ts";

/** Only the shared delegates this reader touches; it claims neither table (R40). */
type DataRetentionProjectScopeDatabase = Pick<PrismaClient, "project" | "team">;

/** Project's `Project` rows and organization's `Team` rows, through their shares. */
export class PrismaDataRetentionProjectScopeRepository implements DataRetentionProjectScopeRepository {
  static create(
    prisma: DataRetentionProjectScopeDatabase,
  ): PrismaDataRetentionProjectScopeRepository {
    return new PrismaDataRetentionProjectScopeRepository(prisma);
  }

  private constructor(private readonly prisma: DataRetentionProjectScopeDatabase) {}

  async findProjectPlacement({
    projectId,
  }: {
    projectId: string;
  }): Promise<DataRetentionProjectPlacement | null> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { teamId: true, kind: true, team: { select: { organizationId: true } } },
    });
    if (!project?.team) return null;

    return {
      projectId,
      organizationId: project.team.organizationId,
      teamId: project.teamId,
      kind: project.kind,
    };
  }

  async findTeamOrganizationId({ teamId }: { teamId: string }): Promise<string | null> {
    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
      select: { organizationId: true },
    });

    return team?.organizationId ?? null;
  }

  async findProjectIds({
    organizationId,
    teamId,
  }: {
    organizationId: string;
    teamId?: string;
  }): Promise<string[]> {
    const projects = await this.prisma.project.findMany({
      where: { team: { organizationId }, ...(teamId === undefined ? {} : { teamId }) },
      select: { id: true },
    });

    return projects.map((project) => project.id);
  }
}
