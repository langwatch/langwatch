import type { PrismaClient } from "~/generated/prisma/client";
import { aggregateRuleFromDb } from "../aggregate-rule";
import {
  AGGREGATE_PROJECT_KIND,
  NON_DESTINATION_PROJECT_KINDS,
} from "../project-kinds";
import type {
  AggregateProjectRepository,
  AggregateRuleRepository,
  StoredAggregateProject,
} from "./aggregate-rule.repository";

/**
 * Every read is scoped to one organisation through the project's team, and
 * leaves out archived projects, archived teams and the kinds an aggregate never
 * reads (the governance project, which is not a workspace, and other
 * aggregates, which own no traces).
 */
export class PrismaAggregateRuleRepository
  implements AggregateRuleRepository, AggregateProjectRepository
{
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

  async findAggregate({
    aggregateProjectId,
  }: {
    aggregateProjectId: string;
  }): Promise<StoredAggregateProject | null> {
    const row = await this.prisma.project.findFirst({
      where: { id: aggregateProjectId, kind: AGGREGATE_PROJECT_KIND },
      select: {
        id: true,
        archivedAt: true,
        aggregateRule: true,
        team: { select: { organizationId: true, archivedAt: true } },
      },
    });
    if (!row) return null;
    return {
      id: row.id,
      organizationId: row.team.organizationId,
      archived: row.archivedAt !== null || row.team.archivedAt !== null,
      rule: aggregateRuleFromDb(row.aggregateRule),
    };
  }

  async findLiveAggregateIds({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<string[]> {
    const rows = await this.prisma.project.findMany({
      where: {
        kind: AGGREGATE_PROJECT_KIND,
        archivedAt: null,
        team: { organizationId, archivedAt: null },
      },
      select: { id: true },
      orderBy: { id: "asc" },
    });
    return rows.map((row) => row.id);
  }
}
