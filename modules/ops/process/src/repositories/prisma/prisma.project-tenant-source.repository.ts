import type { PrismaClient } from "@langwatch/prisma-client/generated";

import {
  ProjectHasNoOrganizationError,
  type ProjectTenantSourceRepository,
} from "../tenant-source.repository.ts";

export class PrismaProjectTenantSourceRepository implements ProjectTenantSourceRepository {
  readonly #prisma: PrismaClient;

  private constructor(prisma: PrismaClient) {
    this.#prisma = prisma;
  }

  static create(prisma: PrismaClient): PrismaProjectTenantSourceRepository {
    return new PrismaProjectTenantSourceRepository(prisma);
  }

  async findTenantIdsAfter({
    cursor,
    limit,
  }: {
    cursor: string | null;
    limit: number;
  }): Promise<string[]> {
    const projects = await this.#prisma.project.findMany({
      where: cursor === null ? {} : { id: { gt: cursor } },
      orderBy: { id: "asc" },
      select: { id: true },
      take: limit,
    });

    return projects.map((project) => project.id);
  }

  async getOrganizationId(projectId: string): Promise<string> {
    const project = await this.#prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { teamId: true },
    });
    // `relationMode = "prisma"` carries no foreign key, so a project can outlive its team.
    const team = await this.#prisma.team.findUnique({
      where: { id: project.teamId },
      select: { organizationId: true },
    });
    if (!team) throw new ProjectHasNoOrganizationError(projectId);
    return team.organizationId;
  }

  async findOrganizationIds({
    projectIds,
  }: {
    projectIds: readonly string[];
  }): Promise<{ projectId: string; organizationId: string }[]> {
    if (projectIds.length === 0) return [];
    const projects = await this.#prisma.project.findMany({
      where: { id: { in: [...projectIds] } },
      select: { id: true, teamId: true },
    });
    const teams = await this.#prisma.team.findMany({
      where: { id: { in: [...new Set(projects.map((project) => project.teamId))] } },
      select: { id: true, organizationId: true },
    });
    const organizationByTeam = new Map(teams.map((team) => [team.id, team.organizationId]));
    // An orphan (its team row is gone) has no organization, like an unknown project: left out.
    return projects.flatMap((project) => {
      const organizationId = organizationByTeam.get(project.teamId);
      return organizationId === undefined ? [] : [{ projectId: project.id, organizationId }];
    });
  }
}
