/**
 * One organization's spend, rolled up per project and narrowed to the projects
 * the caller can reach: their own teams' projects, or every project when they
 * administer the organization.
 */
import type {
  ListOrganizationSpendInput,
  ProjectSpendRollup,
} from "@langwatch/entitlement-contract";
import type { PrismaClient, Project } from "@langwatch/prisma-client/generated";
import { Temporal, toDate } from "@langwatch/time";
import type { OrganizationSpendRepository } from "../organization-spend.repository.ts";

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
            team: {
              organizationId: input.organizationId,
              members: { some: { userId: input.userId } },
            },
          },
          {
            team: {
              organizationId: input.organizationId,
              organization: { members: { some: { userId: input.userId, role: "ADMIN" } } },
            },
          },
        ],
      },
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

    const rollups = new Map<string, { project: Project; costs: ProjectSpendRollup["costs"] }>();
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
