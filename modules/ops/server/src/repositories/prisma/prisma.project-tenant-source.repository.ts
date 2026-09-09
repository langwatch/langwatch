import type { TenantSource } from "@langwatch/system-migrations";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

export class PrismaProjectTenantSourceRepository implements TenantSource {
  readonly #prisma: PrismaClient;

  private constructor(prisma: PrismaClient) {
    this.#prisma = prisma;
  }

  static create(prisma: PrismaClient) {
    return new PrismaProjectTenantSourceRepository(prisma);
  }

  async findTenantIdsAfter({ cursor, limit }: { cursor: string | null; limit: number }) {
    const projects = await this.#prisma.project.findMany({
      where: cursor === null ? {} : { id: { gt: cursor } },
      orderBy: { id: "asc" },
      select: { id: true },
      take: limit,
    });

    return projects.map((project) => project.id);
  }

  async getOrganizationId(projectId: string) {
    const project = await this.#prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { team: { select: { organizationId: true } } },
    });

    return project.team.organizationId;
  }
}
