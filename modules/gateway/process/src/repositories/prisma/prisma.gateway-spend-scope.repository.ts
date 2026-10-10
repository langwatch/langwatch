import type { PrismaClient } from "@langwatch/prisma-client/generated";

import { GatewaySpendScopeRepository } from "../gateway-spend-scope.repository.ts";

/** Gateway-owned key ids behind the external ids a spend filter names. */
export class PrismaGatewaySpendScopeRepository extends GatewaySpendScopeRepository {
  static create(options: {
    database: Pick<PrismaClient, "virtualKey">;
  }): PrismaGatewaySpendScopeRepository {
    return new PrismaGatewaySpendScopeRepository(options.database);
  }

  private constructor(private readonly database: Pick<PrismaClient, "virtualKey">) {
    super();
  }

  async findVirtualKeyIdsForExternalIds({
    organizationId,
    externalIds,
  }: {
    organizationId: string;
    externalIds: string[];
  }): Promise<string[]> {
    const keys = await this.database.virtualKey.findMany({
      where: { organizationId, externalId: { in: externalIds } },
      select: { id: true },
    });
    return keys.map((k) => k.id);
  }
}
