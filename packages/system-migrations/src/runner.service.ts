import { createLogger } from "@langwatch/observability";
import type { MigrationLeaseRepository } from "./lease.repository";
import type { SystemMigrationStateRepository } from "./state.repository";
import type { SystemMigration } from "./system-migration";
import type { TenantSource } from "./tenant-source";
import type { MigrationPassSummary } from "./types";

const logger = createLogger("langwatch:system-migrations");

const TENANT_PAGE_SIZE = 100;

const LEASE_NAME = "system-migrations:pass";
const DEFAULT_LEASE_TTL_MS = 60_000;
/** Renew well inside the TTL so one slow round trip cannot drop the lease. */
const DEFAULT_LEASE_RENEW_INTERVAL_MS = 20_000;

/**
 * Which tenants a pass may touch. The app composes this: self-hosted
 * installations answer true for every tenant (migration just happens, in
 * the background, no configuration), cloud answers from the organizations
 * operators have enrolled, read fresh each pass. A tenant outside the
 * cohort is skipped without even a state record - "not started" and "not
 * enrolled yet" are the same pending state, which is what lets the rollout
 * widen later.
 */
export type MigrationCohort = (tenantId: string) => boolean | Promise<boolean>;

export type SystemMigrationRunnerDeps = {
  state: SystemMigrationStateRepository;
  lease: MigrationLeaseRepository;
  tenants: TenantSource;
  cohort: MigrationCohort;
  migrations: readonly SystemMigration[];
  /** How long each lease grant lasts. Defaults to a minute. */
  leaseTtlMs?: number;
  /** How often the pass renews its lease. Must stay well inside the TTL. */
  leaseRenewIntervalMs?: number;
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
    const { lease, migrations } = this.deps;
    const signal = args?.signal;
    if (migrations.length === 0) {
      return { tenantsSeen: 0, finalized: 0, held: 0, parked: 0, skipped: 0 };
    }

    const ttlMs = this.deps.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS;
    if (!(await lease.acquire({ name: LEASE_NAME, ttlMs }))) {
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

    // A single tenant can outlive the lease TTL on its own - one large
    // organization's parity sweep is a round trip per member - so the lease
    // is held by a timer for as long as the pass runs, not renewed once per
    // tenant between them.
    const heartbeat = this.startLeaseHeartbeat();
    try {
      await this.driveTenants({
        summary,
        signal,
        leaseLost: heartbeat.leaseLost,
      });
    } finally {
      heartbeat.stop();
      await lease.release({ name: LEASE_NAME });
    }

    logger.info({ summary }, "system migration pass complete");
    return summary;
  }

  /**
   * Keeps the lease alive for the whole pass. A renewal that comes back
   * false means another driver has legitimately taken over, which the pass
   * reads as "stop at the next tenant" - never as corruption, since every
   * migration is idempotent.
   */
  private startLeaseHeartbeat(): {
    leaseLost: () => boolean;
    stop: () => void;
  } {
    let lost = false;
    const ttlMs = this.deps.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS;
    const timer = setInterval(() => {
      void this.deps.lease
        .renew({ name: LEASE_NAME, ttlMs })
        .then((held) => {
          if (!held) lost = true;
        })
        .catch(() => {
          lost = true;
        });
    }, this.deps.leaseRenewIntervalMs ?? DEFAULT_LEASE_RENEW_INTERVAL_MS);
    // Never let the heartbeat alone hold the process open at shutdown.
    timer.unref?.();
    return { leaseLost: () => lost, stop: () => clearInterval(timer) };
  }

  /** Every cohort tenant, a page at a time, until abort or lease loss. */
  private async driveTenants(args: {
    summary: MigrationPassSummary;
    signal?: AbortSignal;
    leaseLost: () => boolean;
  }): Promise<void> {
    let cursor: string | null = null;
    for (;;) {
      const page = await this.deps.tenants.findTenantIdsAfter({
        cursor,
        limit: TENANT_PAGE_SIZE,
      });
      if (page.length === 0) return;
      cursor = page[page.length - 1] ?? null;
      if (!(await this.drivePage({ ...args, page }))) return;
    }
  }

  /** One page of tenants. False means the pass must stop here. */
  private async drivePage({
    page,
    summary,
    signal,
    leaseLost,
  }: {
    page: string[];
    summary: MigrationPassSummary;
    signal?: AbortSignal;
    leaseLost: () => boolean;
  }): Promise<boolean> {
    const { cohort, migrations } = this.deps;
    for (const tenantId of page) {
      if (signal?.aborted) return false;
      if (leaseLost()) {
        logger.warn("migration lease lost mid-pass; stopping early");
        return false;
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
    return true;
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
    // The two terminal states: `finalized` is the one-way latch, and
    // `rolled_back` is the operator's pin holding a tenant on its legacy
    // path. Re-running either would undo the operator's decision on the
    // very next boot.
    if (
      existing?.status === "finalized" ||
      existing?.status === "rolled_back"
    ) {
      summary.skipped += 1;
      return;
    }

    try {
      const outcome = await migration.migrateTenant({
        tenantId,
        signal,
        // A migration that writes before it records anything needs to know
        // its last attempt died, so it can finish work the crash stranded.
        previous: existing,
      });
      // Compare-and-set, not a blind upsert: an operator may have pinned the
      // row `rolled_back` while `migrateTenant` ran, and that pin outranks
      // anything this pass concluded. A refused write is the pin winning -
      // terminal for this tenant this pass; the row stays exactly as the
      // operator left it.
      const written = await state.upsertRecordUnlessRolledBack({
        migrationName: migration.name,
        tenantId,
        status: outcome.status,
        report: outcome.report ?? null,
      });
      if (!written) {
        summary.skipped += 1;
        logger.warn(
          { migration: migration.name, tenantId, outcome: outcome.status },
          "an operator rolled the tenant back mid-pass; the pass's outcome is discarded",
        );
        return;
      }
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
      try {
        // The same compare-and-set as the outcome write: a `parked` row that
        // replaced an operator's `rolled_back` pin would be retried on the
        // next pass and re-finalized, undoing the rollback. A refused park
        // costs nothing - the pin already keeps the tenant off every later
        // pass.
        await state.upsertRecordUnlessRolledBack({
          migrationName: migration.name,
          tenantId,
          status: "parked",
          report: {
            kind: "error",
            message: error instanceof Error ? error.message : String(error),
          },
        });
      } catch (parkError) {
        // Recording the park is itself a write, so the very failure most
        // likely to park a tenant - the state store being unreachable - is
        // the one that would throw here and take the rest of the fleet down
        // with it. An unrecorded park costs nothing the next pass cannot
        // rebuild: the tenant is still pending, and it is tried again.
        logger.error(
          { error: parkError, migration: migration.name, tenantId },
          "could not record a parked tenant; continuing the pass",
        );
      }
      logger.error(
        { error, migration: migration.name, tenantId },
        "tenant migration parked on error",
      );
    }
  }
}
