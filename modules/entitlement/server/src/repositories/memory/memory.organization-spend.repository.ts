import type {
  ListOrganizationSpendInput,
  ProjectSpendRollup,
} from "@langwatch/entitlement-contract";
import type { OrganizationSpendRepository } from "../organization-spend.repository.ts";
import { MemoryEntitlementDatabase } from "./memory.entitlement.database.ts";

/**
 * The spend rollup over rows a test put there, narrowed by caller the same way
 * the Postgres twin narrows it: a person sees only the projects recorded for
 * them, and an organization nobody recorded answers with no rollups at all.
 */
export class MemoryOrganizationSpendRepository implements OrganizationSpendRepository {
  #database: MemoryEntitlementDatabase;

  private constructor(database: MemoryEntitlementDatabase) {
    this.#database = database;
  }

  static create(
    input: Readonly<{ memory: MemoryEntitlementDatabase }>,
  ): MemoryOrganizationSpendRepository {
    return new MemoryOrganizationSpendRepository(input.memory);
  }

  async findSpendRollups(input: ListOrganizationSpendInput): Promise<ProjectSpendRollup[]> {
    const organization = this.#database.find(input.organizationId);
    if (!organization) return [];

    return [...(organization.spendByUserId[input.userId] ?? [])];
  }
}
