/**
 * The ops dashboard's view of the in-place migrations, and the operator's levers over them. The
 * rollup and the pass live here; enrollment, a single organization's run, and the rollback each
 * have their own service, composed in, so one operator action is one place to read.
 */

import { createLogger } from "@langwatch/observability";
import {
  MigrationDrainProofRequiresMigratedError,
  MigrationStateNotFoundError,
  type OpsUpgradeListTenantsInput,
  type OpsUpgradeTenantPage,
} from "@langwatch/ops-contract";
import {
  type MigrationPassSummary,
  SystemMigrationRecordNotFoundError,
  TENANT_MIGRATION_STATUSES,
} from "@langwatch/system-migrations";
import { nowInstant, toDate } from "@langwatch/time";
import type { TenantStepStateRow } from "@langwatch/upgrade/step/tenant-state";

import { SYSTEM_MIGRATION_FOLLOW_UP_REQUESTER } from "../../../eventing/ops-system-migrations.process.ts";
import {
  ATTENTION_LIMIT,
  type MigrationEnrollmentRecord,
  type MigrationOverview,
  type SystemMigrationsServiceDependencies,
} from "../../../rules/system-migration-support.rules.ts";
import { SystemMigrationEnrollmentService } from "./system-migration-enrollment.service.ts";
import { SystemMigrationLookupService } from "./system-migration-lookup.service.ts";
import { SystemMigrationRollbackService } from "./system-migration-rollback.service.ts";
import { SystemMigrationRunService } from "./system-migration-run.service.ts";

const logger = createLogger("langwatch:ops:system-migrations");

/** The boot loop's cap and gap (packages/system-migrations/src/convergence.ts:19,27). */
const PASSES_PER_RUN = 25;
const PASS_GAP_MS = 5_000;

/** Held rows the pending check reads; a row held for queued work is re-written each pass. */
const PENDING_SCAN_LIMIT = 200;

/** How many tenant rows one `listTenants` page holds when the caller names no limit. */
const TENANT_PAGE_LIMIT = 50;

export class SystemMigrationsService {
  static create(deps: SystemMigrationsServiceDependencies): SystemMigrationsService {
    return new SystemMigrationsService(deps);
  }

  private readonly enrollment: SystemMigrationEnrollmentService;
  private readonly runs: SystemMigrationRunService;
  private readonly rollback: SystemMigrationRollbackService;

  private readonly lookup = SystemMigrationLookupService.create();

  private constructor(private readonly deps: SystemMigrationsServiceDependencies) {
    this.enrollment = SystemMigrationEnrollmentService.create(deps);
    this.runs = SystemMigrationRunService.create(deps);
    this.rollback = SystemMigrationRollbackService.create(deps);
  }

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
            // A step whose `migrated` is its steady state holds nobody; only parked rows count.
            statuses: migration.migratedIsSteady ? ["parked"] : ["migrated", "parked"],
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
          tenant: migration.tenant ?? "organization",
          migratedIsSteady: migration.migratedIsSteady ?? false,
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
          attention: attention.map(onTheWire),
        };
      }),
    );
  }

  /** One page of tenant rows; the cursor is the next row's offset (ops page, small tables). */
  async listTenants({
    step,
    state,
    cursor,
    limit = TENANT_PAGE_LIMIT,
  }: OpsUpgradeListTenantsInput): Promise<OpsUpgradeTenantPage> {
    const offset = Number.parseInt(cursor ?? "0", 10) || 0;
    const rows = await this.deps.state.findRecordsByStatus({
      migrationName: step,
      statuses: state ? [state] : [...TENANT_MIGRATION_STATUSES],
      limit: limit + 1,
      offset,
    });
    return {
      items: rows.slice(0, limit).map(onTheWire),
      cursor: rows.length > limit ? String(offset + limit) : null,
    };
  }

  /** The enrollment listing for the ops page, audited because it carries enrollers' names. */
  async getEnrollments({ requestedBy }: { requestedBy: string }): Promise<{
    enrollments: MigrationEnrollmentRecord[];
  }> {
    return this.enrollment.getEnrollments({ requestedBy });
  }

  /** Organizations matching what the operator typed, for the enrollment picker. */
  async searchOrganizations(args: { query: string }): Promise<{ id: string; name: string }[]> {
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
   * Whether this migration requires typed destructive confirmation. Read
   * from the migration's declaration so gate and page never disagree about
   * which migration is dangerous.
   */
  requiresOperatorConfirmation({ migrationName }: { migrationName: string }): boolean {
    return this.lookup.registeredMigration(this.deps, migrationName).requiresOperatorConfirmation;
  }

  /**
   * Kick a pass now instead of waiting for the next re-drive. Sent to a worker as a command and
   * awaited until recorded; a double click is harmless, since each organization's claim keeps two
   * passes off it.
   */
  async startPass({ actorUserId }: { actorUserId: string }): Promise<void> {
    await this.deps.requestPass({ actorUserId });
  }

  /** Set once this process has completed a pass; until then every re-drive runs ungated. */
  private passCompletedInProcess = false;

  /**
   * Passes while each advances something; kicks and a process's first pass always run. A run
   * leaving work pending tells the process, whose next wake runs another; tenants waiting on an
   * operator are not pending, so the short cadence ends (Alex, 2026-10-09, 2026-10-13).
   */
  async executePass({ redrive, due = true }: { redrive: boolean; due?: boolean }): Promise<void> {
    if (redrive && this.passCompletedInProcess) {
      if (!due) return;
      if (!(await this.deps.hasTenantAwaitingRedrive())) {
        logger.debug(
          "no parked, held or undiscovered tenant; skipping the system migration re-drive",
        );
        return;
      }
    }
    let summary = await this.deps.runPass({});
    this.passCompletedInProcess = true;
    let advancedInRun = summary.advanced > 0;
    for (let pass = 1; summary.advanced > 0 && pass < PASSES_PER_RUN; pass++) {
      await pauseBetweenPasses();
      summary = await this.deps.runPass({});
      advancedInRun ||= summary.advanced > 0;
    }
    const pending = (advancedInRun && summary.held > 0) || (await this.hasHeldForPendingWork());
    logger.info({ summary, redrive, due, pending }, "system migration pass complete");
    if (!pending) return;
    await this.deps.requestPass({ actorUserId: SYSTEM_MIGRATION_FOLLOW_UP_REQUESTER });
  }

  /** A tenant held while its queued work drains moves by itself, so it is pending, not stuck. */
  private async hasHeldForPendingWork(): Promise<boolean> {
    const held = await this.deps.state.findRecordsByStatus({
      statuses: ["migrated"],
      limit: PENDING_SCAN_LIMIT,
    });
    return held.some((row) => row.heldReason === "pending");
  }

  /** One pass of the startup convergence the tasks process drives, stopping at `signal`. */
  runConvergencePass({ signal }: { signal: AbortSignal }): Promise<MigrationPassSummary> {
    return this.deps.runPass({ signal });
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
    const record = await this.deps.state
      .getRecord({ migrationName, tenantId })
      .catch(refuseWhenNotFound);

    if (record.status !== "migrated") {
      throw new MigrationDrainProofRequiresMigratedError({
        status: record.status,
      });
    }

    const priorReport =
      record.report != null && typeof record.report === "object"
        ? (record.report as Record<string, unknown>)
        : {};
    const assertedAt = nowInstant().toString({ fractionalSecondDigits: 3 });
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

/** A tenant row as the page reads it: when it last moved, as a date. */
function onTheWire({
  updatedAt,
  ...row
}: TenantStepStateRow): MigrationOverview["attention"][number] {
  return { ...row, updatedAt: toDate(updatedAt) };
}

function refuseWhenNotFound(error: unknown): never {
  if (error instanceof SystemMigrationRecordNotFoundError) throw new MigrationStateNotFoundError();
  throw error;
}

/** A pass cannot observe its own events, so the next one waits for the folds to land. */
function pauseBetweenPasses(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, PASS_GAP_MS));
}
