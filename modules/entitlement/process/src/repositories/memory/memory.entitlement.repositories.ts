import type { EntitlementRepositories } from "../entitlement.repositories.ts";
import { MemoryEntitlementDatabase } from "./memory.entitlement.database.ts";
import { MemoryOrganizationSpendRepository } from "./memory.organization-spend.repository.ts";
import { MemoryUsageMembershipRepository } from "./memory.usage-membership.repository.ts";

export class MemoryEntitlementRepositories {
  static readonly requires = [] as const;

  static create(): EntitlementRepositories {
    const database = MemoryEntitlementDatabase.create();

    return {
      membership: MemoryUsageMembershipRepository.create({ memory: database }),
      spend: MemoryOrganizationSpendRepository.create({ memory: database }),
    };
  }
}
