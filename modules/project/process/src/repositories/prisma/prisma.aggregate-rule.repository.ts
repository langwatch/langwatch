import { PrismaRepository } from "@langwatch/prisma-client";
import { NON_DESTINATION_PROJECT_KINDS } from "@langwatch/project-contract";

import type { AggregateRuleRepository } from "../aggregate-rule.repository.ts";

/** A project an aggregate may read: live, on a live team of the organisation, of ordinary kind. */
function readableIn(organizationId: string) {
  return {
    archivedAt: null,
    kind: { notIn: [...NON_DESTINATION_PROJECT_KINDS] },
    team: { organizationId, archivedAt: null },
  };
}

export class PrismaAggregateRuleRepository
  extends PrismaRepository.for("Project")
  implements AggregateRuleRepository
{
  static readonly create = this.factory((prisma) => new PrismaAggregateRuleRepository(prisma));

  async findPersonalProjects({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<{ id: string; ownerUserId: string | null }[]> {
    return this.prisma.project.findMany({
      where: { ...readableIn(organizationId), isPersonal: true },
      select: { id: true, ownerUserId: true },
      orderBy: { id: "asc" },
    });
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
      where: { ...readableIn(organizationId), id: { in: [...projectIds] } },
      select: { id: true },
      orderBy: { id: "asc" },
    });
    return rows.map((row) => row.id);
  }

  async findCandidateProjects({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<{ id: string; name: string; isPersonal: boolean; ownerUserId: string | null }[]> {
    return this.prisma.project.findMany({
      where: readableIn(organizationId),
      select: { id: true, name: true, isPersonal: true, ownerUserId: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    });
  }
}
