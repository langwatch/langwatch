import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { GatewayKeyReachCandidate } from "../gateway-budget.repository";

/** Gateway-owned active-key facts used by the budget reach policy. */
export class PrismaGatewayBudgetScopeReachRepository {
  private constructor(private readonly database: PrismaClient) {}

  static create(database: PrismaClient): PrismaGatewayBudgetScopeReachRepository {
    return new PrismaGatewayBudgetScopeReachRepository(database);
  }

  async list(organizationId: string): Promise<GatewayKeyReachCandidate[]> {
    const keys = await this.database.virtualKey.findMany({
      where: { organizationId, status: "ACTIVE" },
      include: { scopes: true },
    });
    const groupIdsByPrincipal = await this.listGroupIds(
      organizationId,
      keys.map((key) => key.principalUserId),
    );

    return keys.map((key) => ({
      organizationId: key.organizationId,
      scopedTeamIds: key.scopes
        .filter((scope) => scope.scopeType === "TEAM")
        .map((scope) => scope.scopeId),
      traceProjectId: key.traceProjectId,
      virtualKeyId: key.id,
      principalUserId: key.principalUserId,
      groupIds: key.principalUserId
        ? (groupIdsByPrincipal.get(key.principalUserId) ?? [])
        : [],
    }));
  }

  private async listGroupIds(
    organizationId: string,
    principalUserIds: Array<string | null>,
  ): Promise<Map<string, string[]>> {
    const ids = [...new Set(principalUserIds.filter((id): id is string => id !== null))];
    const groupsByPrincipal = new Map<string, string[]>();
    if (ids.length === 0) {
      return groupsByPrincipal;
    }

    const memberships = await this.database.groupMembership.findMany({
      where: { userId: { in: ids }, group: { organizationId } },
      select: { userId: true, groupId: true },
    });
    for (const membership of memberships) {
      const groupIds = groupsByPrincipal.get(membership.userId) ?? [];
      groupIds.push(membership.groupId);
      groupsByPrincipal.set(membership.userId, groupIds);
    }
    return groupsByPrincipal;
  }
}
