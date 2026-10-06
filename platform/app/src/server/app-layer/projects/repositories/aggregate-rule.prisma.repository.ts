import type { PrismaClient } from "~/generated/prisma/client";
import { NON_DESTINATION_PROJECT_KINDS } from "../project.service";
import type { AggregateRuleRepository } from "./aggregate-rule.repository";

/**
 * Every read is scoped to one organisation through the project's team, and
 * leaves out archived projects, archived teams and the kinds an aggregate never
 * reads (the governance project, which is not a workspace, and other
 * aggregates, which own no traces).
 */
export class PrismaAggregateRuleRepository implements AggregateRuleRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findPersonalProjectIds({
    organizationId,
    departmentId,
  }: {
    organizationId: string;
    departmentId?: string;
  }): Promise<string[]> {
    const rows = await this.prisma.project.findMany({
      where: {
        isPersonal: true,
        archivedAt: null,
        kind: { notIn: [...NON_DESTINATION_PROJECT_KINDS] },
        team: { organizationId, archivedAt: null },
        ...(departmentId
          ? {
              ownerUser: {
                orgMemberships: { some: { organizationId, departmentId } },
              },
            }
          : {}),
      },
      select: { id: true },
      orderBy: { id: "asc" },
    });
    return rows.map((row) => row.id);
  }

  async findReadableProjectIds({
    organizationId,
    projectIds,
  }: {
    organizationId: string;
    projectIds: readonly string[];
  }): Promise<string[]> {
    if (projectIds.length === 0) return [];
    const rows = await this.prisma.project.findMany({
      where: {
        id: { in: [...projectIds] },
        archivedAt: null,
        kind: { notIn: [...NON_DESTINATION_PROJECT_KINDS] },
        team: { organizationId, archivedAt: null },
      },
      select: { id: true },
      orderBy: { id: "asc" },
    });
    return rows.map((row) => row.id);
  }

  async departmentBelongsTo({
    organizationId,
    departmentId,
  }: {
    organizationId: string;
    departmentId: string;
  }): Promise<boolean> {
    const department = await this.prisma.department.findFirst({
      where: { id: departmentId, organizationId, archivedAt: null },
      select: { id: true },
    });
    return department !== null;
  }
}
