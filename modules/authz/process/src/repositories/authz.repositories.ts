import type { AuthzAdmissionRepository } from "./authz-admission.repository.ts";
import type { AuthzAuditTrailRepository } from "./authz-audit-trail.repository.ts";
import type { AuthzCutoverRepository } from "./authz-cutover.repository.ts";
import type { AuthzEpochRepository } from "./authz-epoch.repository.ts";
import type { AuthzGrantProjectionRepository } from "./authz-grant-projection.repository.ts";
import type { AuthzListingRepository } from "./authz-listing.repository.ts";
import type { AuthzManagedGrantRepository } from "./authz-managed-grant.repository.ts";
import type { AuthzMembershipStampRepository } from "./authz-membership-stamp.repository.ts";
import type { AuthzMigrationRepository } from "./authz-migration.repository.ts";
import type { AuthzPlatformGrantRepository } from "./authz-platform-grant.repository.ts";
import type { AuthzReadRepository } from "./authz-read.repository.ts";
import type { AuthzRevocationRepository } from "./authz-revocation.repository.ts";
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
  readonly auditTrail: AuthzAuditTrailRepository;
  readonly platformGrants: AuthzPlatformGrantRepository;
  readonly membershipStamps: AuthzMembershipStampRepository;
  readonly grantProjection: AuthzGrantProjectionRepository;
  readonly revocation: AuthzRevocationRepository;
  /** What every decision reads: the grant heads, memberships and lineage. */
  readonly read: AuthzReadRepository;
  readonly listing: AuthzListingRepository;
  /** The ADR-110 import's reads of the legacy tables and the heads it proves. */
  readonly migration: AuthzMigrationRepository;
}
