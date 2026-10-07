import type { BillableEventsMeterRepository } from "./billable-events-meter.repository.ts";
import type { OrganizationSpendRepository } from "./organization-spend.repository.ts";
import type { TraceMeterRepository } from "./trace-meter.repository.ts";
import type { UsageMembershipRepository } from "./usage-membership.repository.ts";

export interface EntitlementRepositories {
  readonly membership: UsageMembershipRepository;
  readonly spend: OrganizationSpendRepository;
  /** The two meters the month's count is read from. */
  readonly billableEvents: BillableEventsMeterRepository;
  readonly traces: TraceMeterRepository;
}
