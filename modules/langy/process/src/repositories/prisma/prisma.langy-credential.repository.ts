import { LangyCredentialResolutionError } from "@langwatch/langy-contract";
import { Prisma } from "@langwatch/prisma-client/generated";

import { LangyCredentialRepository } from "../langy-credential.repository.ts";
import type { LangyDatabase } from "./langy-database.mapper.ts";

export class PrismaLangyCredentialRepository extends LangyCredentialRepository {
  constructor(private readonly prisma: LangyDatabase) {
    super();
  }

  static create(database: LangyDatabase): PrismaLangyCredentialRepository {
    return new PrismaLangyCredentialRepository(database);
  }

  async getProject(projectId: string): Promise<{ organizationId: string }> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { team: { select: { organizationId: true } } },
    });
    if (!project?.team) {
      throw new LangyCredentialResolutionError(`Project ${projectId} not found.`);
    }
    return { organizationId: project.team.organizationId };
  }

  async findVirtualKeyConfigs(input: {
    projectId: string;
    organizationId: string;
  }): Promise<unknown[]> {
    const rows = await this.prisma.virtualKey.findMany({
      where: {
        organizationId: input.organizationId,
        purpose: "LANGY",
        status: "ACTIVE",
        scopes: {
          some: { scopeType: "PROJECT", scopeId: input.projectId },
        },
      },
      orderBy: { updatedAt: "desc" },
      take: 1,
      select: { config: true },
    });
    return rows.flatMap((row) => (row.config == null ? [] : [row.config]));
  }

  async findEgressAllowlists(projectId: string): Promise<unknown[]> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { langyEgressAllowlist: true },
    });
    return project?.langyEgressAllowlist == null ? [] : [project.langyEgressAllowlist];
  }

  async saveEgressAllowlist(projectId: string, allowlist: string[] | null): Promise<void> {
    await this.prisma.project.update({
      where: { id: projectId },
      data: { langyEgressAllowlist: allowlist ?? Prisma.DbNull },
    });
  }
}
