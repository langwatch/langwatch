import type { TenantSource } from "@langwatch/system-migrations";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

/**
 * Tenants for the migration runner are organizations, walked in id order so
 * a pass is stable however often it restarts.
 */
export class PrismaOrganizationTenantSource implements TenantSource {
  constructor(private readonly prisma: PrismaClient) {}

  async findTenantIdsAfter({
    cursor,
    limit,
  }: {
    cursor: string | null;
    limit: number;
  }): Promise<string[]> {
    const rows = await this.prisma.organization.findMany({
      where: cursor === null ? {} : { id: { gt: cursor } },
      orderBy: { id: "asc" },
      select: { id: true },
      take: limit,
    });
    return rows.map((row) => row.id);
  }
}
