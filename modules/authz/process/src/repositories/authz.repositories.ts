import type { AuthzAdmissionRepository } from "./authz-admission.repository.ts";
import type { AuthzCutoverRepository } from "./authz-cutover.repository.ts";
import type { AuthzEpochRepository } from "./authz-epoch.repository.ts";
import type { AuthzManagedGrantRepository } from "./authz-managed-grant.repository.ts";
import type { AuthzSessionVersionRepository } from "./authz-session-version.repository.ts";
import type { AuthzUserStandingRepository } from "./authz-user-standing.repository.ts";

/** The rows the authz module selects at boot: Postgres facts, and the two Redis counters. */
export interface AuthzRepositories {
  readonly bindings: AuthzManagedGrantRepository;
  readonly cutover: AuthzCutoverRepository;
  readonly admissions: AuthzAdmissionRepository;
  readonly userStandings: AuthzUserStandingRepository;
  readonly epoch: AuthzEpochRepository;
  readonly sessionVersions: AuthzSessionVersionRepository;
}
