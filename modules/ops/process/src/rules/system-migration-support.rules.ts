/** Shared stores, hooks, and decisions (migration resolution, cohort sampling) across surface. */

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
  /** Throws `organization_not_found` when the id names no organization. */
  getOrganizationById(args: { organizationId: string }): Promise<{ id: string; name: string }>;
  isEnrolled(args: { organizationId: string; migrationName: string }): Promise<boolean>;
  countEnrolledByMigration(): Promise<Map<string, number>>;
  countOrganizations(): Promise<number>;
  searchOrganizations(args: { query: string }): Promise<{ id: string; name: string }[]>;
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
  }): Promise<{ id: string; name: string }[]>;
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
  }): Promise<OpsMigrationOverview["attention"]>;

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
  migrations: () => {
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
    /** Organization or user axis; omitted means organization. See ADR-101 §6. */
    tenant?: "organization" | "user";
  }[];
  /** Read per call, so the answer is never a boot-time capture. */
  isSaaS: () => boolean;
  enrollments: SystemMigrationEnrollmentStore;
  /**
   * The organizations whose data plane is a private ClickHouse instance, read
   * from the environment's routing table. A cohort must never sweep one up, and
   * the environment - not a list in code - is what names them.
   */
  privateDataplaneOrganizationIds: () => string[];
  /** Ops audit trail; records enrollment, backfill, and listing actions. */
  audit: (entry: {
    userId: string;
    organizationId?: string;
    action: string;
    args?: Record<string, unknown>;
  }) => Promise<void>;
  runPass: () => Promise<MigrationPassSummary>;
  /** One migration for one organization; composition scopes runner to (tenant, migration) pair. */
  runTargetedPass: (args: {
    organizationId: string;
    migrationName: string;
  }) => Promise<MigrationPassSummary>;
  /** Checks if report means WAITED vs held; only migration composition can distinguish. */
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
export function deriveStatusOfMemberSummary(
  summary: MigrationPassSummary,
): TenantMigrationStatus | null {
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
