import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { TenantSource } from "@langwatch/system-migrations";

/** Tenants for USER-rooted migration pass are users walked in id order.
 * Same paging contract as organization source. */
export class PrismaUserTenantSourceRepository implements TenantSource {
  static create({ prisma }: { prisma: PrismaClient }): PrismaUserTenantSourceRepository {
    return new PrismaUserTenantSourceRepository(prisma);
  }

  private constructor(private readonly prisma: PrismaClient) {}

  async findTenantIdsAfter({
    cursor,
    limit,
  }: {
    cursor: string | null;
    limit: number;
  }): Promise<string[]> {
    const rows = await this.prisma.user.findMany({
      where: cursor === null ? {} : { id: { gt: cursor } },
      orderBy: { id: "asc" },
      select: { id: true },
      take: limit,
    });
    return rows.map((row) => row.id);
  }
}

/** One organization's member users for targeted "run now" on
 * user-rooted migration. */
export class PrismaOrganizationMemberTenantSourceRepository implements TenantSource {
  private readonly prisma: PrismaClient;
  private readonly organizationId: string;

  static create({
    prisma,
    organizationId,
  }: {
    prisma: PrismaClient;
    organizationId: string;
  }): PrismaOrganizationMemberTenantSourceRepository {
    return new PrismaOrganizationMemberTenantSourceRepository({ prisma, organizationId });
  }

  private constructor({
    prisma,
    organizationId,
  }: {
    prisma: PrismaClient;
    organizationId: string;
  }) {
    this.prisma = prisma;
    this.organizationId = organizationId;
  }

  async findTenantIdsAfter({
    cursor,
    limit,
  }: {
    cursor: string | null;
    limit: number;
  }): Promise<string[]> {
    const rows = await this.prisma.organizationUser.findMany({
      where: {
        organizationId: this.organizationId,
        ...(cursor === null ? {} : { userId: { gt: cursor } }),
      },
      orderBy: { userId: "asc" },
      select: { userId: true },
      take: limit,
    });
    return rows.map((row) => row.userId);
  }
}
