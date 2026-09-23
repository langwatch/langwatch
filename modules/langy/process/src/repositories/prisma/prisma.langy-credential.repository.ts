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

  async tryFindProject(projectId: string): Promise<{ organizationId: string } | null> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { team: { select: { organizationId: true } } },
    });
    return project?.team ? { organizationId: project.team.organizationId } : null;
  }

  tryFindVirtualKeyConfig(input: { projectId: string; organizationId: string }): Promise<unknown> {
    return this.prisma.virtualKey
      .findFirst({
        where: {
          organizationId: input.organizationId,
          purpose: "LANGY",
          status: "ACTIVE",
          scopes: {
            some: { scopeType: "PROJECT", scopeId: input.projectId },
          },
        },
        orderBy: { updatedAt: "desc" },
        select: { config: true },
      })
      .then((row) => row?.config ?? null);
  }

  async tryFindEgressAllowlist(projectId: string): Promise<unknown> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { langyEgressAllowlist: true },
    });
    return project?.langyEgressAllowlist ?? null;
  }

  async saveEgressAllowlist(projectId: string, allowlist: string[] | null): Promise<void> {
    await this.prisma.project.update({
      where: { id: projectId },
      data: { langyEgressAllowlist: allowlist ?? Prisma.DbNull },
    });
  }
}
