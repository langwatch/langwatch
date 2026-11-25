import {
  GatewayOrganizationDirectoryRepository,
  type GatewayGroupTarget,
} from "../gateway-organization-directory.repository.ts";
import type { MemoryGatewayStore } from "./memory.gateway.store.ts";

/** The groups and memberships the store was seeded with, as a GROUP budget reads them. */
export class MemoryGatewayOrganizationDirectoryRepository extends GatewayOrganizationDirectoryRepository {
  static create(store: MemoryGatewayStore): MemoryGatewayOrganizationDirectoryRepository {
    return new MemoryGatewayOrganizationDirectoryRepository(store);
  }

  private constructor(private readonly store: MemoryGatewayStore) {
    super();
  }

  async findGroupTargets(organizationId: string): Promise<readonly GatewayGroupTarget[]> {
    return this.store.groups
      .filter((group) => group.organizationId === organizationId)
      .toSorted((left, right) => byName(left.name, right.name))
      .map((group) => ({ id: group.id, name: group.name, memberCount: this.#members(group.id) }));
  }

  async groupMemberCounts(
    budgets: readonly { scopeType: string; scopeId: string }[],
  ): Promise<Map<string, number>> {
    const groupIds = new Set(
      budgets.filter((budget) => budget.scopeType === "GROUP").map((budget) => budget.scopeId),
    );

    return new Map(
      this.store.groups
        .filter((group) => groupIds.has(group.id))
        .map((group) => [group.id, this.#members(group.id)]),
    );
  }

  #members(groupId: string): number {
    return this.store.groupMemberships.filter((membership) => membership.groupId === groupId)
      .length;
  }
}

/** Code-point order; the live read uses the column collation, which may differ off ASCII. */
function byName(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}
