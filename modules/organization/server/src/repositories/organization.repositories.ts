import type { GroupRepository } from "./group.repository.ts";
import type { OrganizationRepository } from "./organization.repository.ts";
import type { TeamRepository } from "./team.repository.ts";

/**
 * The rows the organization module owns and constructs through
 * `ServerOrganizationApp.create`, chosen once at boot.
 *
 * Membership (`OrganizationUser`/audit) and invitations are not part of this
 * selection yet: `OrganizationMembershipRepository`'s Postgres implementation
 * is still built directly from `setup.infrastructure.database`, and invites
 * are composed on a separate path outside this module's boot. Both are
 * tracked as follow-up work, not part of this pass.
 */
export interface OrganizationRepositories {
  readonly organization: OrganizationRepository;
  readonly team: TeamRepository;
  readonly group: GroupRepository;
}
