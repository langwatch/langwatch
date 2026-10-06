/**
 * The membership and spend rows behind one organization's usage reading.
 */
import type { Prisma, PrismaClient } from "@langwatch/prisma-client/generated";

import type { UsageMembershipRepository } from "../usage-membership.repository.ts";

/** Only what this repository needs, named so a caller never names Prisma's own types. */
type PrismaUsageMembershipDatabase = PrismaClient | Prisma.TransactionClient;

/** The first instant of the current calendar month, in the process's zone. */
function getCurrentMonthStart(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

/** The spend rows behind one organization's usage reading; seats are organization's to count. */
export class PrismaUsageMembershipRepository implements UsageMembershipRepository {
  static create(prisma: PrismaUsageMembershipDatabase): PrismaUsageMembershipRepository {
    return new PrismaUsageMembershipRepository(prisma);
  }

  private constructor(private readonly prisma: PrismaUsageMembershipDatabase) {}

  /**
   * Helper to get all project IDs for an organization.
   * Used by methods that need to query models with RLS policies.
   */
  private async getProjectIds(organizationId: string): Promise<string[]> {
    const projects = await this.prisma.project.findMany({
      where: { team: { organizationId } },
      select: { id: true },
    });
    return projects.map((p) => p.id);
  }

  /**
   * Gets current month cost for an organization.
   * Aggregates costs across all projects in the organization.
   */
  async findCurrentMonthCost(organizationId: string): Promise<number> {
    const projectIds = (
      await this.prisma.project.findMany({
        where: { team: { organizationId } },
        select: { id: true },
      })
    ).map((project) => project.id);

    return this.findCurrentMonthCostForProjects(projectIds);
  }

  /**
   * Gets current month cost for a list of projects.
   */
  async findCurrentMonthCostForProjects(projectIds: string[]): Promise<number> {
    return (
      (
        await this.prisma.cost.aggregate({
          where: {
            projectId: { in: projectIds },
            createdAt: { gte: getCurrentMonthStart() },
          },
          _sum: { amount: true },
        })
      )._sum?.amount ?? 0
    );
  }
}
