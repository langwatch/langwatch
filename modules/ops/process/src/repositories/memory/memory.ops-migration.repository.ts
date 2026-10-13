import {
  type SystemMigrationStateRepository,
  TENANT_MIGRATION_STATUSES,
} from "@langwatch/system-migrations";
import { fromDate, type Instant, nowInstant, Temporal } from "@langwatch/time";
import type {
  MemoryTenantStepStateRepository,
  TenantStepStateRow,
} from "@langwatch/upgrade/step/tenant-state";

import { type MovedTenantSteps, OpsMigrationRepository } from "../ops-migration.repository.ts";
import type { SystemMigrationStateRepository as OpsStateRepository } from "../system-migration.repository.ts";
import type { MemorySystemMigrationEnrollmentRepository } from "./memory.system-migration-enrollment.repository.ts";

/** The copy twin: ops' legacy state and enrolment twins into the moved step's twins. */
export class MemoryOpsMigrationRepository extends OpsMigrationRepository {
  static create(stores: {
    legacy: Pick<OpsStateRepository, "findRecordsByStatus">;
    steps: Pick<SystemMigrationStateRepository, "getRecord" | "upsertRecord"> &
      Pick<MemoryTenantStepStateRepository, "findRecordsByStatus">;
    enrolments: Pick<
      MemorySystemMigrationEnrollmentRepository,
      "findAll" | "isEnrolled" | "createMany" | "delete"
    >;
  }): MemoryOpsMigrationRepository {
    return new MemoryOpsMigrationRepository(stores);
  }

  private constructor(
    private readonly stores: Parameters<typeof MemoryOpsMigrationRepository.create>[0],
  ) {
    super();
  }

  async copyTenantState({
    moves,
    dryRun,
  }: {
    moves: MovedTenantSteps;
    dryRun: boolean;
  }): Promise<number> {
    let copied = 0;
    for (const [legacyName, stepId] of Object.entries(moves)) {
      const settled = await this.stores.legacy.findRecordsByStatus({
        migrationName: legacyName,
        statuses: ["finalized", "rolled_back"],
        limit: Number.MAX_SAFE_INTEGER,
      });
      for (const { updatedAt: _updatedAt, ...record } of settled) {
        const present = await this.stores.steps
          .getRecord({ migrationName: stepId, tenantId: record.tenantId })
          .then(() => true)
          .catch(() => false);
        if (present) continue;
        copied += 1;
        if (!dryRun) await this.stores.steps.upsertRecord({ ...record, migrationName: stepId });
      }
    }
    return copied;
  }

  async recopyTenantStateAfterRollout({
    moves,
    dryRun,
  }: {
    moves: MovedTenantSteps;
    dryRun: boolean;
  }): Promise<number> {
    let copied = 0;
    const statuses = [...TENANT_MIGRATION_STATUSES];
    for (const [legacyName, stepId] of Object.entries(moves)) {
      const own = await this.stores.steps.findRecordsByStatus({
        migrationName: stepId,
        statuses,
        limit: Number.MAX_SAFE_INTEGER,
      });
      const legacy = await this.stores.legacy.findRecordsByStatus({
        migrationName: legacyName,
        statuses,
        limit: Number.MAX_SAFE_INTEGER,
      });
      for (const { updatedAt, ...record } of legacy) {
        if (!movedSince({ own, tenantId: record.tenantId, movedAt: fromDate(updatedAt) })) continue;
        copied += 1;
        if (dryRun) continue;
        const held = record.status === "migrated" ? { heldReason: "proof" as const } : {};
        await this.stores.steps.upsertRecord({
          ...record,
          ...held,
          ...(record.status === "migrated" ? { heldSince: nowInstant() } : {}),
          migrationName: stepId,
        });
      }
    }
    return copied;
  }

  async withdrawEnrolmentsAfterRollout({
    moves,
    dryRun,
  }: {
    moves: MovedTenantSteps;
    dryRun: boolean;
  }): Promise<number> {
    const legacyNames = new Map(Object.entries(moves).map(([legacy, stepId]) => [stepId, legacy]));
    let withdrawn = 0;
    for (const { organizationId, migrationName } of await this.stores.enrolments.findAll()) {
      const legacyName = legacyNames.get(migrationName);
      if (legacyName === undefined) continue;
      if (await this.stores.enrolments.isEnrolled({ organizationId, migrationName: legacyName }))
        continue;
      withdrawn += 1;
      if (!dryRun) await this.stores.enrolments.delete({ organizationId, migrationName });
    }
    return withdrawn;
  }

  async copyEnrolments({
    moves,
    dryRun,
  }: {
    moves: MovedTenantSteps;
    dryRun: boolean;
  }): Promise<number> {
    let copied = 0;
    for (const {
      organizationId,
      migrationName,
      enrolledByUserId,
    } of await this.stores.enrolments.findAll()) {
      const stepId = Object.hasOwn(moves, migrationName) ? moves[migrationName] : undefined;
      if (stepId === undefined) continue;
      if (await this.stores.enrolments.isEnrolled({ organizationId, migrationName: stepId }))
        continue;
      copied += 1;
      if (!dryRun) {
        await this.stores.enrolments.createMany({
          organizationIds: [organizationId],
          migrationName: stepId,
          enrolledByUserId,
        });
      }
    }
    return copied;
  }
}

/** Whether the older table's row moved after the step's own, which a rollback pin outranks. */
function movedSince({
  own,
  tenantId,
  movedAt,
}: {
  own: readonly TenantStepStateRow[];
  tenantId: string;
  movedAt: Instant;
}): boolean {
  const current = own.find((row) => row.tenantId === tenantId);
  if (current === undefined) return true;
  if (current.status === "rolled_back") return false;
  return Temporal.Instant.compare(current.updatedAt, movedAt) < 0;
}
