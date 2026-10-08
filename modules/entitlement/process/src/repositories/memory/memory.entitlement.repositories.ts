import type { EntitlementRepositories } from "../entitlement.repositories.ts";
import { MemoryBillableEventsMeterRepository } from "./memory.billable-events-meter.repository.ts";
import { MemoryEntitlementDatabase } from "./memory.entitlement.database.ts";
import { MemoryOrganizationSpendRepository } from "./memory.organization-spend.repository.ts";
import { MemoryTraceMeterRepository } from "./memory.trace-meter.repository.ts";
import { MemoryUsageMembershipRepository } from "./memory.usage-membership.repository.ts";

export class MemoryEntitlementRepositories {
  static readonly requires = [] as const;

  static create(): EntitlementRepositories {
    const database = MemoryEntitlementDatabase.create();
    const billableEvents = MemoryBillableEventsMeterRepository.create();

    return {
      membership: MemoryUsageMembershipRepository.create({ memory: database }),
      spend: MemoryOrganizationSpendRepository.create({ memory: database }),
      billableEvents,
      traces: MemoryTraceMeterRepository.create(),
    };
  }
}
