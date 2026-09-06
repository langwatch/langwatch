/**
 * What every part of the migrations surface shares: the stores it reads, the deployment facts and
 * per-migration hooks its composition supplies, and the two small decisions — which migration a name
 * refers to, and a uniform sample of a cohort — that would otherwise be copied into each part.
 */

import type { OpsMigrationEnrollmentRecord, OpsMigrationOverview } from "@langwatch/ops-contract";
import type {
  MigrationPassSummary,
  TenantMigrationRecord,
  TenantMigrationStatus,
} from "@langwatch/system-migrations";

/**
 * The statuses a tenant may be rolled back from. What `migrated` means is each migration's own
 * business — the cutover parks tenants there while they merely wait on prerequisites — so the
 * status check here is only the generic floor, per-migration preconditions living in the guards.
 */
export const ROLLBACK_EFFECT_STATUSES: readonly TenantMigrationStatus[] = [
  "migrated",
  "finalized",
  "rolled_back",
];

/**
 * One enrollment row as the ops page lists it.
 */
export type MigrationEnrollmentRecord = OpsMigrationEnrollmentRecord;

/**
 * The enrollment store the ops actions write through. Uniqueness refusals
 * (duplicate enroll, withdraw of nothing) are the store's - the unique key
 * is the only race-free check - and both surface as handled errors.
 */
export interface SystemMigrationEnrollmentStore {
  findAll(): Promise<MigrationEnrollmentRecord[]>;
  tryFindOrganizationById(args: {
    organizationId: string;
  }): Promise<{ id: string; name: string } | null>;
  isEnrolled(args: { organizationId: string; migrationName: string }): Promise<boolean>;
  countEnrolledByMigration(): Promise<Map<string, number>>;
  countOrganizations(): Promise<number>;
  searchOrganizations(args: { query: string }): Promise<Array<{ id: string; name: string }>>;
  create(args: {
    organizationId: string;
    migrationName: string;
    enrolledByUserId: string;
  }): Promise<void>;
  findCohortEligibleOrganizations(args: {
    migrationName: string;
    /** When set, the pool is restricted to organizations already enrolled
     *  for this migration - a later step samples the step before it. */
    enrolledForMigrationName?: string;
    excludeOrganizationIds: string[];
    /** Lift the enterprise-subscription exclusion for this draw. Defaults to
     *  false at the repository, so a caller that says nothing gets the safe
     *  pool rather than the wide one. */
    includeEnterprise?: boolean;
  }): Promise<Array<{ id: string; name: string }>>;
  createMany(args: {
    organizationIds: string[];
    migrationName: string;
    enrolledByUserId: string;
  }): Promise<{ insertedCount: number }>;
  delete(args: { organizationId: string; migrationName: string }): Promise<void>;
}

export interface SystemMigrationStateReader {
  findStatusCounts(args: { migrationName: string }): Promise<Record<TenantMigrationStatus, number>>;

  findRecordsByStatus(args: {
    migrationName: string;
    statuses: TenantMigrationStatus[];
    limit: number;
  }): Promise<Array<TenantMigrationRecord & { updatedAt: Date }>>;

  tryFindRecord(args: {
    migrationName: string;
    tenantId: string;
  }): Promise<TenantMigrationRecord | null>;

  upsertRecord(record: TenantMigrationRecord): Promise<void>;
}

/** How many attention rows one migration lists before the page truncates. */

export type SystemMigrationsServiceDependencies = {
  state: SystemMigrationStateReader;
  /** Every registered migration's listing-facing declaration, cutover last. */
  migrations: () => Array<{
    name: string;
    title: string;
    description: string;
    requiresOperatorConfirmation: boolean;
    runsAutomaticallyOnSelfHosted: boolean;
    /**
     * Whether cloud puts every organization in this migration's cohort
     * with no enrollment row. The enrollment actions refuse for such a
     * migration rather than writing rows nothing reads.
     */
    enrolledAutomatically: boolean;
    /**
     * Which axis the runner drives this migration over. Organization migrations form the ordered per-organization pipeline; a user enrollment but its
     * tenants are the organization's MEMBERS, so it is neither a step in that pipeline nor readable back by organization id. Omitted means organization.
     * migration (ADR-101 §6) is paced by the same organization
     */
    tenant?: "organization" | "user";
  }>;
  /** Read per call, so the answer is never a boot-time capture. */
  isSaaS: () => boolean;
  enrollments: SystemMigrationEnrollmentStore;
  /**
   * The organizations whose data plane is a private ClickHouse instance, read
   * from the environment's routing table. A cohort must never sweep one up, and
   * the environment - not a list in code - is what names them.
   */
  privateDataplaneOrganizationIds: () => string[];
  /**
   * The ops audit trail. Enrollment decides which organizations the platform migrates, so both actions are recorded
   * the way the backfill's own writes are - and the enrollment LISTING is recorded too, because it returns the
   * enrollers' display names (personal data). A platform-scope entry carries no organizationId.
   */
  audit: (entry: {
    userId: string;
    organizationId?: string;
    action: string;
    args?: Record<string, unknown>;
  }) => Promise<void>;
  runPass: () => Promise<MigrationPassSummary>;
  /**
   * One migration for one organization, now, under the same per-organization claim as a full pass (the
   * summary's `claimed` says another pass is already working the organization). The composition supplies
   * it because only the composition can build a runner scoped to a single (tenant, migration) pair.
   */
  runTargetedPass: (args: {
    organizationId: string;
    migrationName: string;
  }) => Promise<MigrationPassSummary>;
  /**
   * Whether a migration's stored report means it merely WAITED, per migration name. The state
   * machine has no waiting status, so only the migration's own composition can tell a waiting
   * tenant from a held one; a migration that never waits has no entry.
   */
  waitingReports?: Record<string, (report: unknown) => boolean>;
  /**
   * What else a rollback has to DO, per migration name. The generic rollback is a state write; a
   * migration whose finalization changed how the running fleet behaves needs that undone too, and
   * only its own composition knows how. Migrations with nothing to undo have no entry.
   */
  rollbackEffects?: Record<
    string,
    (args: { tenantId: string; actorUserId: string; decidedAt: string }) => Promise<void>
  >;
  /**
   * What must HOLD before a rollback may even be pinned, per migration name. The generic service
   * knows the state machine, not that one migration's state depends on another's; that is domain
   * knowledge and lives in the composition. A guard refuses by throwing, before the pin is written.
   */
  rollbackGuards?: Record<
    string,
    (args: {
      tenantId: string;
      /** Null when nothing has run for this tenant yet - the operator is
       *  pinning it OUT of a rollout ahead of the pass, and a guard that
       *  needs a record has to say so itself rather than assume one. */
      record: TenantMigrationRecord | null;
    }) => Promise<void>
  >;
};

export const ATTENTION_LIMIT = 50;

/** One migration as the operator dashboard lists it. */
export type MigrationOverview = OpsMigrationOverview;

/**
 * A uniform sample without replacement: Fisher-Yates over a copy, first `count` entries. A pool
 * smaller than the ask returns the whole pool — the caller reports how many it got rather than
 * erroring.
 */
export function sample<T>({ pool, count }: { pool: T[]; count: number }): T[] {
  const copy = [...pool];
  const size = Math.min(count, copy.length);
  for (let index = 0; index < size; index++) {
    const swap = index + Math.floor(Math.random() * (copy.length - index));
    [copy[index], copy[swap]] = [copy[swap] as T, copy[index] as T];
  }

  return copy.slice(0, size);
}

/**
 * One status for a targeted run over an organization's members: the worst outcome wins, because
 * the operator is deciding whether the organization needs attention, and null when no member was
 * in the cohort. Members already terminal before the run keep their terminal colour.
 */
export function statusOfMemberSummary(summary: MigrationPassSummary): TenantMigrationStatus | null {
  if (summary.parked > 0) {
    return "parked";
  }

  if (summary.held > 0 || summary.claimed > 0) {
    return "migrated";
  }

  if (summary.alreadyRolledBack > 0) {
    return "rolled_back";
  }

  if (summary.finalized > 0 || summary.alreadyFinalized > 0) {
    return "finalized";
  }

  return null;
}
