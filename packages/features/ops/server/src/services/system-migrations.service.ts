/**
 * The ops dashboard's view of the in-place migrations, and the operator's levers over them. The
 * rollup and the pass live here; enrollment, a single organization's run, and the rollback each
 * have their own service, composed in, so one operator action is one place to read.
 */

import { createLogger } from "@langwatch/observability";
import {
  MigrationDrainProofRequiresMigratedError,
  MigrationStateNotFoundError,
} from "@langwatch/ops-contract";
import { SystemMigrationEnrollmentService } from "./system-migration-enrollment.service.ts";
import { SystemMigrationRollbackService } from "./system-migration-rollback.service.ts";
import { SystemMigrationRunService } from "./system-migration-run.service.ts";
import {
  ATTENTION_LIMIT,
  type MigrationEnrollmentRecord,
  type MigrationOverview,
  type SystemMigrationsServiceDependencies,
} from "../rules/system-migration-support.rules.ts";
import { systemMigrationLookup } from "./system-migration-lookup.service.ts";

export type {
  MigrationEnrollmentRecord,
  MigrationOverview,
  SystemMigrationEnrollmentStore,
  SystemMigrationStateReader,
} from "../rules/system-migration-support.rules.ts";

const logger = createLogger("langwatch:ops:system-migrations");

export class SystemMigrationsService {
  static create(deps: SystemMigrationsServiceDependencies): SystemMigrationsService {
    return new SystemMigrationsService(deps);
  }

  private constructor(
    private readonly deps: SystemMigrationsServiceDependencies,
    private readonly enrollment = SystemMigrationEnrollmentService.create(deps),
    private readonly runs = SystemMigrationRunService.create(deps),
    private readonly rollback = SystemMigrationRollbackService.create(deps),
  ) {}

  /**
   * Per migration: the status rollup, plus the tenants needing attention - held (`migrated`,
   * parity disagreements in the report) and `parked` (errored, retried next pass). Finalized
   * tenants are a count, not a listing, and neither are rolled-back ones.
   */
  async getOverview(): Promise<MigrationOverview[]> {
    const isSaaS = this.deps.isSaaS();
    // One pair of queries for every migration's gauge, not a pair per
    // migration: the page polls this.
    const [enrolledByMigration, totalOrganizations] = isSaaS
      ? await Promise.all([
          this.deps.enrollments.countEnrolledByMigration(),
          this.deps.enrollments.countOrganizations(),
        ])
      : [null, 0];

    return Promise.all(
      this.deps.migrations().map(async (migration) => {
        const enrolledCount = enrolledByMigration?.get(migration.name) ?? 0;
        // Together, not one after the other: the page polls this, and the
        // rollup does not feed the listing.
        const [counts, attention] = await Promise.all([
          this.deps.state.findStatusCounts({ migrationName: migration.name }),
          this.deps.state.findRecordsByStatus({
            migrationName: migration.name,
            statuses: ["migrated", "parked"],
            limit: ATTENTION_LIMIT,
          }),
        ]);

        return {
          name: migration.name,
          title: migration.title,
          description: migration.description,
          requiresOperatorConfirmation: migration.requiresOperatorConfirmation,
          availableOnThisInstallation: isSaaS || migration.runsAutomaticallyOnSelfHosted,
          enrolledAutomatically: migration.enrolledAutomatically,
          counts,
          // Null for a migration that admits every organization automatically:
          // the gauge would describe rows that decide nothing. That is what
          // `MigrationOverview.enrollment` documents, and the guard was lost in
          // the same merge that dropped D04 — leaving the code contradicting
          // its own type's doc comment, with the test that pinned it gone too.
          enrollment:
            enrolledByMigration && !migration.enrolledAutomatically
              ? {
                  enrolledCount,
                  notEnrolledCount: Math.max(0, totalOrganizations - enrolledCount),
                }
              : null,
          attention,
        };
      }),
    );
  }

  /** The enrollment listing for the ops page, audited because it carries enrollers' names. */
  async getEnrollments({ requestedBy }: { requestedBy: string }): Promise<{
    isSaaS: boolean;
    enrollments: MigrationEnrollmentRecord[];
  }> {
    return this.enrollment.getEnrollments({ requestedBy });
  }

  /** Organizations matching what the operator typed, for the enrollment picker. */
  async searchOrganizations(args: { query: string }): Promise<Array<{ id: string; name: string }>> {
    return this.enrollment.searchOrganizations(args);
  }

  /** Opens one organization's enrollment in a migration. */
  async enroll(args: Parameters<SystemMigrationEnrollmentService["enroll"]>[0]): Promise<void> {
    return this.enrollment.enroll(args);
  }

  /** Opens a sampled cohort's enrollment in a migration. */
  async enrollCohort(
    args: Parameters<SystemMigrationEnrollmentService["enrollCohort"]>[0],
  ): ReturnType<SystemMigrationEnrollmentService["enrollCohort"]> {
    return this.enrollment.enrollCohort(args);
  }

  /** Pauses a rollout for one organization by withdrawing its enrollment. */
  async withdraw(args: Parameters<SystemMigrationEnrollmentService["withdraw"]>[0]): Promise<void> {
    return this.enrollment.withdraw(args);
  }

  /** Runs one migration for one organization now, awaited rather than fire-and-forget. */
  async runForOrganization(
    args: Parameters<SystemMigrationRunService["runForOrganization"]>[0],
  ): ReturnType<SystemMigrationRunService["runForOrganization"]> {
    return this.runs.runForOrganization(args);
  }

  /** Pins a migrated or finalized organization back onto its legacy path. */
  async rollBack(args: Parameters<SystemMigrationRollbackService["rollBack"]>[0]): Promise<void> {
    return this.rollback.rollBack(args);
  }

  /**
   * Whether acting on this migration takes the typed destructive confirmation. Read from the migration's
   * own declaration so the gate and the page that renders it can never disagree about which migration is
   * dangerous; an unknown name is refused before any confirmation question arises.
   */
  requiresOperatorConfirmation({ migrationName }: { migrationName: string }): boolean {
    return systemMigrationLookup.registeredMigration(this.deps, migrationName)
      .requiresOperatorConfirmation;
  }

  /**
   * Kick a pass now instead of waiting for the next worker boot - the lever for processing a fresh enrollment right away or
   * re-verifying held tenants after remediation. Fire-and-forget: per-organization claims keep two passes off the same
   * organization, so the worst case for a double click is a pass that finds everything claimed and does nothing.
   */
  startPass(): void {
    void this.deps.runPass().catch((error) => {
      // Per-tenant failures park-and-log inside the pass; this catches the
      // pass itself dying (state table or tenant source down). The next boot
      // retries either way.
      logger.error({ error }, "operator-kicked migration pass failed");
    });
  }

  /**
   * Records the deployment fact that no legacy-only Stored Objects writer can
   * create bytes after reconciliation. The proof lives in the existing
   * migration report, not in another domain table.
   */
  async assertLegacyWritersDrained({
    migrationName,
    tenantId,
    minimumWriterGeneration,
    actorUserId,
  }: {
    migrationName: string;
    tenantId: string;
    minimumWriterGeneration: string;
    actorUserId: string;
  }): Promise<void> {
    const record = await this.deps.state.tryFindRecord({
      migrationName,
      tenantId,
    });
    if (!record) {
      throw new MigrationStateNotFoundError();
    }

    if (record.status !== "migrated") {
      throw new MigrationDrainProofRequiresMigratedError({
        status: record.status,
      });
    }

    const priorReport =
      record.report != null && typeof record.report === "object"
        ? (record.report as Record<string, unknown>)
        : {};
    const assertedAt = new Date().toISOString();
    await this.deps.state.upsertRecord({
      ...record,
      report: {
        ...priorReport,
        legacyWriterDrainProof: {
          minimumWriterGeneration,
          assertedAt,
          actorUserId,
        },
      },
    });
    logger.warn(
      {
        migrationName,
        tenantId,
        minimumWriterGeneration,
        actorUserId,
        assertedAt,
      },
      "operator asserted that legacy-only writers are drained",
    );
  }
}
