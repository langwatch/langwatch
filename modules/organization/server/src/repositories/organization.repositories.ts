import type { AuthzGrantsService } from "@langwatch/authz-contract";
import type { TenantDirectory } from "@langwatch/clickhouse-client";
import type { GroupRepository } from "./group.repository.ts";
import type { OrganizationMembershipRepository } from "./organization-membership.repository.ts";
import type { OrganizationRepository } from "./organization.repository.ts";
import type { TeamRepository } from "./team.repository.ts";
import type { PersonalTeamScopeReader } from "../services/personal-team-scope.service.ts";
import type { TenantOwnershipReader } from "../services/tenant-directory.service.ts";

/**
 * The rows the organization module owns and constructs through
 * `ServerOrganizationApp.create`, chosen once at boot.
 *
 * Invitations are still composed on a separate path outside this module's
 * boot; that is tracked as follow-up work, not part of this pass.
 */
export interface OrganizationRepositories {
  readonly organization: OrganizationRepository;
  readonly team: TeamRepository;
  readonly group: GroupRepository;
  /**
   * Bound at app creation over the AuthZ peer: every accepted seat and role
   * change is a ledger fact (ADR-092), and the ledger is a module dependency,
   * not persistence infrastructure, so it is not known when persistence is chosen.
   */
  readonly membership: (grants: AuthzGrantsService) => OrganizationMembershipRepository;
  readonly personalTeamScope: PersonalTeamScopeReader;
  readonly tenantDirectory: TenantDirectory & TenantOwnershipReader;
}
