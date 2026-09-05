import type { GatewayBudget, PrismaClient } from "@langwatch/prisma-client/generated";
import { VirtualKeyDirectBudgetRepository } from "../gateway-virtual-key-direct-budget.repository";

/** The client slice the direct-budget read binds to. */
export type VirtualKeyDirectBudgetDatabase = Pick<PrismaClient, "gatewayBudget" | "project">;

/** Private Prisma owner for the cap a virtual key carries on itself. */
export class PrismaVirtualKeyDirectBudgetRepository extends VirtualKeyDirectBudgetRepository {
  static create(input: {
    database: VirtualKeyDirectBudgetDatabase;
  }): PrismaVirtualKeyDirectBudgetRepository {
    return new PrismaVirtualKeyDirectBudgetRepository(input.database);
  }

  private constructor(private readonly database: VirtualKeyDirectBudgetDatabase) {
    super();
  }

  findBudgetsTargetingKeys({
    organizationId,
    virtualKeyIds,
  }: {
    organizationId: string;
    virtualKeyIds: string[];
  }): Promise<GatewayBudget[]> {
    return this.database.gatewayBudget.findMany({
      where: {
        organizationId,
        archivedAt: null,
        OR: [
          { scopeType: "VIRTUAL_KEY", scopeId: { in: virtualKeyIds } },
          { managedByVirtualKeyId: { in: virtualKeyIds } },
        ],
      },
      orderBy: { createdAt: "asc" },
    });
  }

  async findProjectIdsInOrganization({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<string[]> {
    const projects = await this.database.project.findMany({
      where: { team: { organizationId } },
      select: { id: true },
    });

    return projects.map((project) => project.id);
  }
}
