import { createLogger } from "@langwatch/observability";
import type { MigrationLeaseRepository } from "./lease.repository";
import type { SystemMigrationStateRepository } from "./state.repository";
import type { SystemMigration } from "./system-migration";
import type { TenantSource } from "./tenant-source";
import type { MigrationPassSummary } from "./types";

const logger = createLogger("langwatch:system-migrations");

const TENANT_PAGE_SIZE = 100;

/**
 * Which tenants a pass may touch. The app composes this: self-hosted
 * installations answer true for every tenant (migration just happens, in
 * the background, no configuration), cloud reads the rollout cohort from
 * the environment. A tenant outside the cohort is skipped without even a
 * state record - "not started" and "not in the cohort yet" are the same
 * pending state, which is what lets the cohort widen later.
 */
export type MigrationCohort = (tenantId: string) => boolean | Promise<boolean>;

export type SystemMigrationRunnerDeps = {
  state: SystemMigrationStateRepository;
  lease: MigrationLeaseRepository;
  tenants: TenantSource;
  cohort: MigrationCohort;
  migrations: readonly SystemMigration[];
};

/**
 * Drives every registered migration over every cohort tenant, once per
 * boot, under a fleet-wide lease (one driver at a time). Level-triggered
 * on the restart cadence: each pass re-attempts held and parked tenants,
 * so a tenant whose blocker was fixed heals itself with no manual state
 * change, and a pass that dies anywhere simply happens again next boot.
 */
export class SystemMigrationRunnerService {
  constructor(private readonly deps: SystemMigrationRunnerDeps) {}

  /**
   * One full pass. Returns null when another process holds the lease -
   * that process is running the same pass, so there is nothing to do.
   */
  async runPass(args?: {
    signal?: AbortSignal;
  }): Promise<MigrationPassSummary | null> {
    const { state, lease, tenants, cohort, migrations } = this.deps;
    const signal = args?.signal;
    if (migrations.length === 0) {
      return { tenantsSeen: 0, finalized: 0, held: 0, parked: 0, skipped: 0 };
    }

    const leaseName = "system-migrations:pass";
    const leaseTtlMs = 60_000;
    if (!(await lease.acquire({ name: leaseName, ttlMs: leaseTtlMs }))) {
      logger.info("another process holds the migration lease; standing down");
      return null;
    }

    const summary: MigrationPassSummary = {
      tenantsSeen: 0,
      finalized: 0,
      held: 0,
      parked: 0,
      skipped: 0,
    };

    try {
      let cursor: string | null = null;
      let stopEarly = false;
      while (!stopEarly) {
        const page = await tenants.findTenantIdsAfter({
          cursor,
          limit: TENANT_PAGE_SIZE,
        });
        if (page.length === 0) break;
        cursor = page[page.length - 1] ?? null;

        for (const tenantId of page) {
          if (signal?.aborted) {
            stopEarly = true;
            break;
          }
          // A lost lease means another driver may already be running: stop
          // early rather than double-drive. Idempotent migrations make the
          // truncated pass harmless.
          if (!(await lease.renew({ name: leaseName, ttlMs: leaseTtlMs }))) {
            logger.warn("migration lease lost mid-pass; stopping early");
            stopEarly = true;
            break;
          }

          summary.tenantsSeen += 1;
          if (!(await cohort(tenantId))) {
            summary.skipped += 1;
            continue;
          }

          for (const migration of migrations) {
            await this.runMigrationForTenant({
              migration,
              tenantId,
              signal,
              summary,
            });
          }
        }
      }
    } finally {
      await lease.release({ name: leaseName });
    }

    logger.info({ summary }, "system migration pass complete");
    return summary;
  }

  private async runMigrationForTenant({
    migration,
    tenantId,
    signal,
    summary,
  }: {
    migration: SystemMigration;
    tenantId: string;
    signal?: AbortSignal;
    summary: MigrationPassSummary;
  }): Promise<void> {
    const { state } = this.deps;
    const existing = await state.findRecord({
      migrationName: migration.name,
      tenantId,
    });
    // The one-way latch: a finalized tenant is done forever.
    if (existing?.status === "finalized") {
      summary.skipped += 1;
      return;
    }

    try {
      const outcome = await migration.migrateTenant({ tenantId, signal });
      await state.upsertRecord({
        migrationName: migration.name,
        tenantId,
        status: outcome.status,
        report: outcome.report ?? null,
      });
      if (outcome.status === "finalized") summary.finalized += 1;
      else if (outcome.status === "migrated") summary.held += 1;
      else summary.parked += 1;
      logger.info(
        { migration: migration.name, tenantId, status: outcome.status },
        "tenant migration outcome",
      );
    } catch (error) {
      // Parked, never fatal: the tenant stays on its legacy path (behaviour
      // unchanged) and the next pass tries again. One broken tenant must
      // not stop the fleet.
      summary.parked += 1;
      await state.upsertRecord({
        migrationName: migration.name,
        tenantId,
        status: "parked",
        report: {
          kind: "error",
          message: error instanceof Error ? error.message : String(error),
        },
      });
      logger.error(
        { error, migration: migration.name, tenantId },
        "tenant migration parked on error",
      );
    }
  }
}
