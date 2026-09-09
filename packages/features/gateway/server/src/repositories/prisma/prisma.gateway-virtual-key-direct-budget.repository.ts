import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { GatewayBudget as GatewayBudgetRow } from "@langwatch/gateway-contract";
import { VirtualKeyDirectBudgetRepository } from "../gateway-virtual-key-direct-budget.repository.ts";
import { toGatewayBudgetRow } from "./prisma.gateway-budget.repository.ts";

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

  async findBudgetsTargetingKeys({
    organizationId,
    virtualKeyIds,
  }: {
    organizationId: string;
    virtualKeyIds: string[];
  }): Promise<GatewayBudgetRow[]> {
    const rows = await this.database.gatewayBudget.findMany({
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

    return rows.map(toGatewayBudgetRow);
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
