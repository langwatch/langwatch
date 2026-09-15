import type { UsageMembershipRepository } from "../usage-membership.repository.ts";
import { MemoryEntitlementDatabase } from "./memory.entitlement.database.ts";

/**
 * The membership reader over rows a test put there. An organization nobody
 * recorded has no members and has spent nothing, which is what the Postgres
 * twin answers for one with no rows either.
 */
export class MemoryUsageMembershipRepository implements UsageMembershipRepository {
  #database: MemoryEntitlementDatabase;

  private constructor(database: MemoryEntitlementDatabase) {
    this.#database = database;
  }

  static create(
    input: Readonly<{ memory: MemoryEntitlementDatabase }>,
  ): MemoryUsageMembershipRepository {
    return new MemoryUsageMembershipRepository(input.memory);
  }

  async getMemberCount(organizationId: string): Promise<number> {
    return this.#database.find(organizationId)?.memberCount ?? 0;
  }

  async getMembersLiteCount(organizationId: string): Promise<number> {
    return this.#database.find(organizationId)?.membersLiteCount ?? 0;
  }

  async getCurrentMonthCost(organizationId: string): Promise<number> {
    return this.#database.find(organizationId)?.currentMonthCost ?? 0;
  }

  async getCurrentMonthCostForProjects(projectIds: string[]): Promise<number> {
    let total = 0;
    for (const organization of this.#database.all()) {
      for (const projectId of projectIds) {
        total += organization.projectCosts[projectId] ?? 0;
      }
    }

    return total;
  }
}
