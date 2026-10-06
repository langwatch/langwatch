import type { AuthzRepositories } from "../authz.repositories.ts";
import { AuthzMemoryStore } from "./authz-memory.store.ts";
import { MemoryAuthzAdmissionRepository } from "./memory.authz-admission.repository.ts";
import { MemoryAuthzAuditTrailRepository } from "./memory.authz-audit-trail.repository.ts";
import { MemoryAuthzCutoverRepository } from "./memory.authz-cutover.repository.ts";
import { MemoryAuthzEpochRepository } from "./memory.authz-epoch.repository.ts";
import { MemoryAuthzGrantProjectionRepository } from "./memory.authz-grant-projection.repository.ts";
import { MemoryAuthzListingRepository } from "./memory.authz-listing.repository.ts";
import { MemoryAuthzManagedGrantRepository } from "./memory.authz-managed-grant.repository.ts";
import { MemoryAuthzMembershipStampRepository } from "./memory.authz-membership-stamp.repository.ts";
import { MemoryAuthzMigrationRepository } from "./memory.authz-migration.repository.ts";
import { MemoryAuthzPlatformGrantRepository } from "./memory.authz-platform-grant.repository.ts";
import { MemoryAuthzReadRepository } from "./memory.authz-read.repository.ts";
import { MemoryAuthzRevocationRepository } from "./memory.authz-revocation.repository.ts";
import { MemoryAuthzSessionVersionRepository } from "./memory.authz-session-version.repository.ts";
import { MemoryAuthzUserStandingRepository } from "./memory.authz-user-standing.repository.ts";

export class MemoryAuthzRepositories {
  static readonly requires = [] as const;

  static create(): AuthzRepositories {
    const memory = AuthzMemoryStore.create();

    return {
      bindings: MemoryAuthzManagedGrantRepository.create({ memory }),
      cutover: MemoryAuthzCutoverRepository.create({ memory }),
      admissions: MemoryAuthzAdmissionRepository.create({ memory }),
      userStandings: MemoryAuthzUserStandingRepository.create({ memory }),
      epoch: MemoryAuthzEpochRepository.create({ memory }),
      sessionVersions: MemoryAuthzSessionVersionRepository.create({ memory }),
      auditTrail: MemoryAuthzAuditTrailRepository.create({ memory }),
      platformGrants: MemoryAuthzPlatformGrantRepository.create({ memory }),
      membershipStamps: MemoryAuthzMembershipStampRepository.create({ memory }),
      grantProjection: MemoryAuthzGrantProjectionRepository.create({ memory }),
      revocation: MemoryAuthzRevocationRepository.create({ memory }),
      read: MemoryAuthzReadRepository.create({ memory }),
      listing: MemoryAuthzListingRepository.create({ memory }),
      migration: MemoryAuthzMigrationRepository.create({ memory }),
    };
  }
}
