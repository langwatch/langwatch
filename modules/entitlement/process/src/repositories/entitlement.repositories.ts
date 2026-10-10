import type { BillableEventsMeterRepository } from "./billable-events-meter.repository.ts";
import type { MemberSeatRepository } from "./member-seat.repository.ts";
import type { OrganizationSpendRepository } from "./organization-spend.repository.ts";
import type { TenancyRepository } from "./tenancy.repository.ts";
import type { TraceMeterRepository } from "./trace-meter.repository.ts";
import type { UsageMembershipRepository } from "./usage-membership.repository.ts";

export interface EntitlementRepositories {
  readonly membership: UsageMembershipRepository;
  readonly spend: OrganizationSpendRepository;
  /** Member seats, through organization's declared shares (R-C1f). */
  readonly seats: MemberSeatRepository;
  /** Project placement and organisation pricing columns, through their owners' shares. */
  readonly tenancy: TenancyRepository;
  /** The two meters the month's count is read from. */
  readonly billableEvents: BillableEventsMeterRepository;
  readonly traces: TraceMeterRepository;
}
