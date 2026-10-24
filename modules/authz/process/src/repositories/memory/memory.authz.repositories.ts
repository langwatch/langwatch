import { type Instant, Temporal } from "@langwatch/time";

import { type AuthzEngineSwitch, LEGACY_ENGINE } from "../../rules/authz-engine-switch.rules.ts";
import { AuthzCutoverRepository } from "../authz-cutover.repository.ts";
import { AuthzEpochRepository } from "../authz-epoch.repository.ts";
import { AuthzSessionVersionRepository } from "../authz-session-version.repository.ts";
import type { AuthzRepositories } from "../authz.repositories.ts";
import { AuthzMemoryStore } from "./authz-memory.store.ts";
import { MemoryAuthzAdmissionRepository } from "./memory.authz-admission.repository.ts";
import { MemoryAuthzAuditTrailRepository } from "./memory.authz-audit-trail.repository.ts";
import { MemoryAuthzBraidLockRepository } from "./memory.authz-braid-lock.repository.ts";
import { MemoryAuthzGrantProjectionRepository } from "./memory.authz-grant-projection.repository.ts";
import { MemoryAuthzLedgerReadRepository } from "./memory.authz-ledger-read.repository.ts";
import { MemoryAuthzLineageEpochRepository } from "./memory.authz-lineage-epoch.repository.ts";
import { MemoryAuthzListingRepository } from "./memory.authz-listing.repository.ts";
import { MemoryAuthzManagedGrantRepository } from "./memory.authz-managed-grant.repository.ts";
import { MemoryAuthzMembershipStampRepository } from "./memory.authz-membership-stamp.repository.ts";
import { MemoryAuthzMigrationRepository } from "./memory.authz-migration.repository.ts";
import { MemoryAuthzOrganizationPolicyRepository } from "./memory.authz-organization-policy.repository.ts";
import { MemoryAuthzPlatformGrantRepository } from "./memory.authz-platform-grant.repository.ts";
import { MemoryAuthzReadRepository } from "./memory.authz-read.repository.ts";
import { MemoryAuthzRevocationRepository } from "./memory.authz-revocation.repository.ts";
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
      lineageEpochs: MemoryAuthzLineageEpochRepository.create({ memory }),
      sessionVersions: MemoryAuthzSessionVersionRepository.create({ memory }),
      auditTrail: MemoryAuthzAuditTrailRepository.create({ memory }),
      platformGrants: MemoryAuthzPlatformGrantRepository.create({ memory }),
      membershipStamps: MemoryAuthzMembershipStampRepository.create({ memory }),
      grantProjection: MemoryAuthzGrantProjectionRepository.create({ memory }),
      revocation: MemoryAuthzRevocationRepository.create({ memory }),
      read: MemoryAuthzReadRepository.create({ memory }),
      listing: MemoryAuthzListingRepository.create({ memory }),
      migration: MemoryAuthzMigrationRepository.create({ memory }),
      ledgerReads: MemoryAuthzLedgerReadRepository.create({ memory }),
      braidLocks: MemoryAuthzBraidLockRepository.create(),
      organizationPolicies: MemoryAuthzOrganizationPolicyRepository.create(),
    };
  }
}

/** The engine switch a process without a database keeps, written by tests. */
export class MemoryAuthzCutoverRepository extends AuthzCutoverRepository {
  static create(options: { memory: AuthzMemoryStore }): MemoryAuthzCutoverRepository {
    return new MemoryAuthzCutoverRepository(options.memory);
  }

  private constructor(private readonly memory: AuthzMemoryStore) {
    super();
  }

  async getEngineSwitch({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<AuthzEngineSwitch> {
    const row = this.memory.cutovers.get(organizationId);
    return row ? { onEngine: row.onEngine, switchedAt: row.switchedAt } : LEGACY_ENGINE;
  }

  async switchOnEngine({
    organizationId,
    at,
  }: {
    organizationId: string;
    at: Instant;
  }): Promise<boolean> {
    const row = this.memory.cutovers.get(organizationId);
    if (row?.pinned) return false;
    this.memory.cutovers.set(organizationId, { organizationId, onEngine: true, switchedAt: at });
    return true;
  }

  async pinEngineSwitch({
    organizationId,
    at,
    eventId,
  }: {
    organizationId: string;
    at: Instant;
    eventId: string;
  }): Promise<void> {
    const row = this.memory.cutovers.get(organizationId);
    const switchedAt =
      row && Temporal.Instant.compare(row.switchedAt, at) > 0 ? row.switchedAt : at;
    this.memory.cutovers.set(organizationId, {
      organizationId,
      onEngine: false,
      switchedAt,
      pinned: true,
      lastAppliedEventId: eventId,
    });
  }

  /** No older state table exists in memory, so there is nothing to carry over. */
  async carryOverEngineSwitch(_input: { dryRun: boolean }): Promise<number> {
    return 0;
  }
}

/** The epoch a process without Redis keeps, for as long as it runs. */
export class MemoryAuthzEpochRepository extends AuthzEpochRepository {
  static create(options: { memory: AuthzMemoryStore }): MemoryAuthzEpochRepository {
    return new MemoryAuthzEpochRepository(options.memory);
  }

  private constructor(private readonly memory: AuthzMemoryStore) {
    super();
  }

  async findEpoch({ organizationId }: { organizationId: string }): Promise<number | null> {
    return this.memory.epochs.get(organizationId) ?? null;
  }

  async bump({ organizationId }: { organizationId: string }): Promise<void> {
    this.memory.epochs.set(organizationId, (this.memory.epochs.get(organizationId) ?? 0) + 1);
  }
}

/** The session versions a process without Redis keeps, for as long as it runs. */
export class MemoryAuthzSessionVersionRepository extends AuthzSessionVersionRepository {
  static create(options: { memory: AuthzMemoryStore }): MemoryAuthzSessionVersionRepository {
    return new MemoryAuthzSessionVersionRepository(options.memory);
  }

  private constructor(private readonly memory: AuthzMemoryStore) {
    super();
  }

  async getVersion({ userId }: { userId: string }): Promise<number> {
    return this.memory.sessionVersions.get(userId) ?? 0;
  }

  async bump({ userIds }: { userIds: readonly string[] }): Promise<void> {
    for (const userId of userIds) {
      this.memory.sessionVersions.set(userId, (this.memory.sessionVersions.get(userId) ?? 0) + 1);
    }
  }
}
