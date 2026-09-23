import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { TRPCError } from "@trpc/server";

/** The client slice the organization/group tenancy reads below touch. */
export type GatewayOrganizationDirectoryDatabase = Pick<
  PrismaClient,
  "organization" | "group" | "groupMembership" | "organizationUser"
>;

export class PrismaGatewayOrganizationDirectoryRepository {
  static create(
    database: GatewayOrganizationDirectoryDatabase,
  ): PrismaGatewayOrganizationDirectoryRepository {
    return new PrismaGatewayOrganizationDirectoryRepository(database);
  }

  private constructor(private readonly database: GatewayOrganizationDirectoryDatabase) {}

  /** Refuses an organization id that names no organization. */
  async assertExists(organizationId: string): Promise<void> {
    const organization = await this.database.organization.findUnique({
      where: { id: organizationId },
    });
    if (!organization) {
      throw new TRPCError({ code: "NOT_FOUND", message: "organization not found" });
    }
  }

  /** The groups a per-member budget can target, with their sizes. */
  async findGroupTargets(
    organizationId: string,
  ): Promise<readonly { id: string; name: string; memberCount: number }[]> {
    const groups = await this.database.group.findMany({
      where: { organizationId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    const memberCounts = await this.countMembers(groups.map((group) => group.id));

    return groups.map((group) => ({
      id: group.id,
      name: group.name,
      memberCount: memberCounts.get(group.id) ?? 0,
    }));
  }

  /** How many members a per-member GROUP allowance currently covers. */
  async groupMemberCounts(
    budgets: readonly { scopeType: string; scopeId: string }[],
  ): Promise<Map<string, number>> {
    const groupIds = Array.from(
      new Set(budgets.filter((b) => b.scopeType === "GROUP").map((b) => b.scopeId)),
    );
    if (groupIds.length === 0) return new Map();
    const groups = await this.database.group.findMany({
      where: { id: { in: groupIds } },
      select: { id: true },
    });
    const memberCounts = await this.countMembers(groups.map((group) => group.id));

    return new Map(groups.map((group) => [group.id, memberCounts.get(group.id) ?? 0]));
  }

  private async countMembers(groupIds: string[]): Promise<Map<string, number>> {
    if (groupIds.length === 0) return new Map();
    const counts = await this.database.groupMembership.groupBy({
      by: ["groupId"],
      where: { groupId: { in: groupIds } },
      _count: { groupId: true },
    });
    return new Map(counts.map((row) => [row.groupId, row._count.groupId]));
  }

  /** Whether a user belongs to this organization. */
  async isMember(input: { organizationId: string; userId: string }): Promise<boolean> {
    return (
      (await this.database.organizationUser.findFirst({
        where: { organizationId: input.organizationId, userId: input.userId },
        select: { userId: true },
      })) !== null
    );
  }
}
