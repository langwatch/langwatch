import type { TenantSource } from "@langwatch/system-migrations";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

/**
 * Tenants for the USER-rooted migration pass are users, walked in id order
 * (ADR-101 §6: the identity migrations' tenant is the user, because a user
 * can belong to many organizations or none). Same paging contract as the
 * organization source, so the generic runner drives both unchanged.
 */
export class PrismaUserTenantSource implements TenantSource {
  constructor(private readonly prisma: PrismaClient) {}

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

/**
 * One organization's member users, for the targeted "run now" action on a
 * user-rooted migration: the operator names an organization (pacing stays
 * org-driven) and the pass drives its members.
 */
export class PrismaOrganizationMemberTenantSource implements TenantSource {
  private readonly prisma: PrismaClient;
  private readonly organizationId: string;

  constructor({
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
