import type { AuthzGrantsService } from "@langwatch/authz-contract";

import type { OrganizationScopeGraphReader } from "../services/organization-scope-graph.service.ts";
import type { PersonalTeamScopeReader } from "../services/personal-team-scope.service.ts";
import type { GroupRepository } from "./group.repository.ts";
import type { OrganizationInviteRateLimitRepository } from "./organization-invite-rate-limit.repository.ts";
import type { OrganizationInviteRepository } from "./organization-invite.repository.ts";
import type { OrganizationMembershipRepository } from "./organization-membership.repository.ts";
import type { OrganizationSeatRepository } from "./organization-seat.repository.ts";
import type { OrganizationUserDirectoryRepository } from "./organization-user-directory.repository.ts";
import type { OrganizationRepository } from "./organization.repository.ts";
import type { SignUpPolicyRepository } from "./sign-up-policy.repository.ts";
import type { TeamRepository } from "./team.repository.ts";

/** The rows the organization module owns, chosen once at boot for `OrganizationModule.create`. */
export interface OrganizationRepositories {
  readonly organization: OrganizationRepository;
  readonly team: TeamRepository;
  readonly group: GroupRepository;
  /**
   * Bound at app creation over the AuthZ peer: every accepted seat and role
   * change is a ledger fact (ADR-092), and the ledger is a module dependency,
   * not persistence members, so it is not known when persistence is chosen.
   */
  readonly membership: (grants: AuthzGrantsService) => OrganizationMembershipRepository;
  readonly personalTeamScope: PersonalTeamScopeReader;
  readonly scopeGraph: OrganizationScopeGraphReader;
  /** The installation-wide reads the sign-up policy decides over. */
  readonly signUpPolicy: SignUpPolicyRepository;
  /** The fixed-window counter both invitation throttles spend. */
  readonly inviteRateLimit: OrganizationInviteRateLimitRepository;
  /** The invitations and what an invitation is validated and settled against. */
  readonly invite: OrganizationInviteRepository;
  /** The full, lite and Developer seats an organization holds, as licence and plan count them. */
  readonly seats: OrganizationSeatRepository;
  /** The organization's own reads of the people table. */
  readonly userDirectory: OrganizationUserDirectoryRepository;
}
