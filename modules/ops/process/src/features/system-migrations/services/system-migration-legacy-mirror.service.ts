import type {
  SystemMigrationStateRepository as RunnerStateRepository,
  TenantMigrationRecord,
} from "@langwatch/system-migrations";
import type { TenantStepSettleState } from "@langwatch/upgrade/step/tenant-state";

import type { MovedTenantSteps } from "../../../repositories/ops-migration.repository.ts";
import type {
  SystemMigrationEnrollmentStore,
  SystemMigrationStateReader,
} from "../../../rules/system-migration-support.rules.ts";

/** The declared steps' state as the pass and the migrations page use it. */
type DeclaredState = RunnerStateRepository & TenantStepSettleState & SystemMigrationStateReader;

/**
 * Writes both tables while an older release could still be rolled back to (Alex, 2026-10-12): each
 * moved step's finished or rolled-back tenant, and each enrolment or withdrawal, also lands in ops'
 * older tables under the old name. Stops in a later release (dev/docs/ARCHITECTURE.md §7).
 */
export class SystemMigrationLegacyMirrorService {
  static create(options: {
    legacy: Pick<RunnerStateRepository, "upsertRecord" | "upsertRecordUnlessRolledBack">;
    moves: MovedTenantSteps;
  }): SystemMigrationLegacyMirrorService {
    return new SystemMigrationLegacyMirrorService(
      options.legacy,
      new Map(Object.entries(options.moves).map(([legacyName, stepId]) => [stepId, legacyName])),
    );
  }

  private constructor(
    private readonly legacy: Pick<
      RunnerStateRepository,
      "upsertRecord" | "upsertRecordUnlessRolledBack"
    >,
    private readonly legacyNames: ReadonlyMap<string, string>,
  ) {}

  /** The declared state; each terminal write of a moved step also lands in the older table. */
  state(state: DeclaredState): DeclaredState {
    return {
      getRecord: (args) => state.getRecord(args),
      findRecords: (args) => state.findRecords(args),
      hasFinalizedTenant: (args) => state.hasFinalizedTenant(args),
      hasUnsettledTenant: (args) => state.hasUnsettledTenant(args),
      findStatusCounts: (args) => state.findStatusCounts(args),
      findRecordsByStatus: (args) => state.findRecordsByStatus(args),
      upsertRecord: async (record) => {
        await state.upsertRecord(record);
        await this.mirrorRecord(record);
      },
      upsertRecordUnlessRolledBack: async (record) => {
        const written = await state.upsertRecordUnlessRolledBack(record);
        if (written) await this.mirrorRecord(record);
        return written;
      },
    };
  }

  /** The enrolment store; each enrolment or withdrawal of a moved step is repeated by old name. */
  enrollments(store: SystemMigrationEnrollmentStore): SystemMigrationEnrollmentStore {
    return {
      findAll: () => store.findAll(),
      getOrganizationById: (args) => store.getOrganizationById(args),
      isEnrolled: (args) => store.isEnrolled(args),
      countEnrolledByMigration: () => store.countEnrolledByMigration(),
      countOrganizations: () => store.countOrganizations(),
      searchOrganizations: (args) => store.searchOrganizations(args),
      findCohortEligibleOrganizations: (args) => store.findCohortEligibleOrganizations(args),
      create: async (args) => {
        await store.create(args);
        const legacyName = this.legacyNames.get(args.migrationName);
        if (legacyName === undefined) return;
        await store.createMany({
          organizationIds: [args.organizationId],
          migrationName: legacyName,
          enrolledByUserId: args.enrolledByUserId,
        });
      },
      createMany: async (args) => {
        const inserted = await store.createMany(args);
        const legacyName = this.legacyNames.get(args.migrationName);
        if (legacyName !== undefined)
          await store.createMany({ ...args, migrationName: legacyName });
        return inserted;
      },
      delete: async (args) => {
        await store.delete(args);
        const legacyName = this.legacyNames.get(args.migrationName);
        if (legacyName === undefined) return;
        const enrolled = await store.isEnrolled({ ...args, migrationName: legacyName });
        if (enrolled) await store.delete({ ...args, migrationName: legacyName });
      },
    };
  }

  /** Finished never replaces an operator's rollback there; a rollback always lands. */
  private async mirrorRecord(record: TenantMigrationRecord): Promise<void> {
    const migrationName = this.legacyNames.get(record.migrationName);
    if (migrationName === undefined) return;
    const legacyRecord = {
      tenantId: record.tenantId,
      status: record.status,
      report: record.report,
    };
    if (record.status === "rolled_back") {
      await this.legacy.upsertRecord({ ...legacyRecord, migrationName });
    } else if (record.status === "finalized") {
      await this.legacy.upsertRecordUnlessRolledBack({ ...legacyRecord, migrationName });
    }
  }
}
