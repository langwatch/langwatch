import type { OrganizationSpendRepository } from "./organization-spend.repository.ts";
import type { UsageMembershipRepository } from "./usage-membership.repository.ts";

export interface EntitlementRepositories {
  readonly membership: UsageMembershipRepository;
  readonly spend: OrganizationSpendRepository;
}
