import type { PrismaClient } from "@langwatch/prisma-client/generated";

import { SsoDomainOwnershipRepository } from "../sso-domain-ownership.repository.ts";
import { PrismaSsoConnectionProjectionRepository } from "./prisma.sso-connection-projection.repository.ts";

export type PrismaSsoDomainOwnershipDatabase = Pick<PrismaClient, "ssoConnection" | "$transaction">;

/** Re-derives the ownership rows through the fold's own transaction write. */
export class PrismaSsoDomainOwnershipRepository extends SsoDomainOwnershipRepository {
  static create(database: PrismaSsoDomainOwnershipDatabase): PrismaSsoDomainOwnershipRepository {
    return new PrismaSsoDomainOwnershipRepository(database);
  }

  private constructor(private readonly prisma: PrismaSsoDomainOwnershipDatabase) {
    super();
  }

  async findConnectionIds({ organizationId }: { organizationId: string }): Promise<string[]> {
    const rows = await this.prisma.ssoConnection.findMany({
      where: { organizationId },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((row) => row.id);
  }

  async reproject({ connectionId }: { connectionId: string }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const row = await tx.ssoConnection.findUnique({ where: { id: connectionId } });
      if (!row) return;
      await PrismaSsoConnectionProjectionRepository.projectOwnershipInTransaction(tx, {
        connectionId,
        state: PrismaSsoConnectionProjectionRepository.rowToConnection(row),
      });
    });
  }
}
