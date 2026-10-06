import type { PrismaClient } from "@langwatch/prisma-client/generated";

import type { ProjectTenantSourceRepository } from "../project-tenant-source.repository.ts";

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
      select: { team: { select: { organizationId: true } } },
    });

    return project.team.organizationId;
  }
}
