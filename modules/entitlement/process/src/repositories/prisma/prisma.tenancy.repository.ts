import type { PrismaClient } from "@langwatch/prisma-client/generated";

import type { ProjectPlacement, TenancyRepository } from "../tenancy.repository.ts";

/** Only the shared delegates this reader touches; it claims neither table (R40). */
type PrismaTenancyDatabase = Pick<PrismaClient, "project" | "organization">;

/** Project's `Project` rows and organization's `Organization` columns, through their shares. */
export class PrismaTenancyRepository implements TenancyRepository {
  static create(prisma: PrismaTenancyDatabase): PrismaTenancyRepository {
    return new PrismaTenancyRepository(prisma);
  }

  private constructor(private readonly prisma: PrismaTenancyDatabase) {}

  async getProjectPlacement({ projectId }: { projectId: string }): Promise<ProjectPlacement> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { team: { select: { organizationId: true } } },
    });
    const organizationId = project?.team?.organizationId;

    return organizationId ? { kind: "placed", organizationId } : { kind: "unplaced" };
  }

  async findProjectIds({ organizationId }: { organizationId: string }): Promise<string[]> {
    const projects = await this.prisma.project.findMany({
      where: { team: { organizationId } },
      select: { id: true },
    });

    return projects.map((project) => project.id);
  }

  async findMeteredOrganizationIds(): Promise<string[]> {
    const projects = await this.prisma.project.findMany({
      distinct: ["teamId"],
      select: { team: { select: { organizationId: true } } },
    });

    return [...new Set(projects.map((project) => project.team.organizationId))];
  }

  async getCurrency({ organizationId }: { organizationId: string }): Promise<"USD" | "EUR"> {
    const row = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { currency: true },
    });

    return row?.currency ?? "EUR";
  }

  async getDatasetLimits({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<{ attachmentMaxMb: number | null }> {
    const row = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { datasetAttachmentMaxMb: true },
    });

    return { attachmentMaxMb: row?.datasetAttachmentMaxMb ?? null };
  }
}
