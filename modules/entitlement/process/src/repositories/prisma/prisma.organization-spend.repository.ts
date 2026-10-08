/**
 * One organization's spend, rolled up per project and narrowed to the projects
 * the caller can reach: their own teams' projects, or every project when they
 * administer the organization.
 */
import type {
  ListOrganizationSpendInput,
  ProjectSpendRollup,
} from "@langwatch/entitlement-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { Temporal, toDate } from "@langwatch/time";

import type { OrganizationSpendRepository } from "../organization-spend.repository.ts";

/**
 * Project's `projectKindsHiddenFrom`, spelled out because entitlement holds no
 * edge to project's contract: the governance project is never a row of its own,
 * and an aggregate is listed to organisation admins only (ADR-175 decision 5).
 */
const HIDDEN_FROM_ADMINISTRATORS = ["internal_governance"];
const HIDDEN_FROM_MEMBERS = ["internal_governance", "aggregate"];

export class PrismaOrganizationSpendRepository implements OrganizationSpendRepository {
  static create(prisma: PrismaClient): PrismaOrganizationSpendRepository {
    return new PrismaOrganizationSpendRepository(prisma);
  }

  private constructor(private readonly prisma: PrismaClient) {}

  async findSpendRollups(input: ListOrganizationSpendInput): Promise<ProjectSpendRollup[]> {
    const projects = await this.prisma.project.findMany({
      where: {
        OR: [
          {
            kind: { notIn: HIDDEN_FROM_MEMBERS },
            team: {
              organizationId: input.organizationId,
              members: { some: { userId: input.userId } },
            },
          },
          {
            kind: { notIn: HIDDEN_FROM_ADMINISTRATORS },
            team: {
              organizationId: input.organizationId,
              organization: { members: { some: { userId: input.userId, role: "ADMIN" } } },
            },
          },
        ],
      },
      select: { id: true, name: true, slug: true, teamId: true },
    });
    const projectsById = new Map(projects.map((project) => [project.id, project]));
    const projectIds = [...projectsById.keys()];
    const createdAt = {
      gte: toDate(Temporal.Instant.fromEpochMilliseconds(input.startDate)),
      lte: toDate(Temporal.Instant.fromEpochMilliseconds(input.endDate)),
    };

    const [traceCheckCosts, otherCosts] = await Promise.all([
      this.prisma.cost.groupBy({
        by: ["projectId", "costType", "referenceId", "costName", "currency"],
        where: { projectId: { in: projectIds }, costType: "TRACE_CHECK", createdAt },
        _sum: { amount: true },
        _count: { id: true },
      }),
      this.prisma.cost.groupBy({
        by: ["projectId", "costType", "currency"],
        where: { projectId: { in: projectIds }, NOT: { costType: "TRACE_CHECK" }, createdAt },
        _sum: { amount: true },
        _count: { id: true },
      }),
    ]);

    const rollups = new Map<string, ProjectSpendRollup>();
    for (const cost of [...traceCheckCosts, ...otherCosts]) {
      const project = projectsById.get(cost.projectId);
      if (!project) continue;

      const rollup = rollups.get(cost.projectId) ?? { project, costs: [] };
      rollup.costs.push(cost);
      rollups.set(cost.projectId, rollup);
    }

    return [...rollups.values()];
  }
}
