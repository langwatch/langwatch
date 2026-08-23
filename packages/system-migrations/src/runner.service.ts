import { createLogger } from "@langwatch/observability";
import type { MigrationLeaseRepository } from "./lease.repository";
import type { SystemMigrationStateRepository } from "./state.repository";
import type { SystemMigration } from "./system-migration";
import type { TenantSource } from "./tenant-source";
import { isTerminalTenantStatus, type MigrationPassSummary } from "./types";

const logger = createLogger("langwatch:system-migrations");

const TENANT_PAGE_SIZE = 100;

/** One claim per organization: `system-migrations:lease:` + this + the id. */
const TENANT_CLAIM_PREFIX = "tenant:";
const DEFAULT_LEASE_TTL_MS = 60_000;
/** Renew well inside the TTL so one slow round trip cannot drop the claim. */
const DEFAULT_LEASE_RENEW_INTERVAL_MS = 20_000;
/** How many organizations one pass works at once. Each is its own claim,
 *  its own migrations, its own convergence waits - so one large
 *  organization's import never holds the rest of the fleet behind it. The
 *  per-tenant work is light (the fold queue does the heavy lifting), so
 *  the bound exists to cap claim heartbeats and convergence polls, not
 *  throughput. */
const DEFAULT_TENANT_CONCURRENCY = 25;

/**
 * Which (tenant, migration) pairs a pass may touch. The app composes this:
 * self-hosted installations answer true for every tenant (migration just
 * happens, in the background, no configuration), cloud answers from the
 * per-migration enrollments operators have written, read fresh each pass.
 * A pair outside the cohort is skipped without even a state record - "not
 * started" and "not enrolled yet" are the same pending state, which is what
 * lets the rollout widen later, and what lets each migration pace
 * independently of the others.
 */
export type MigrationCohort = (args: {
  tenantId: string;
  migrationName: string;
}) => boolean | Promise<boolean>;

export type SystemMigrationRunnerDeps = {
  state: SystemMigrationStateRepository;
  lease: MigrationLeaseRepository;
  tenants: TenantSource;
  cohort: MigrationCohort;
  migrations: readonly SystemMigration[];
  /** How long each claim grant lasts. Defaults to a minute. */
  leaseTtlMs?: number;
  /** How often a held claim renews. Must stay well inside the TTL. */
  leaseRenewIntervalMs?: number;
  /** How many organizations to migrate concurrently. Defaults to 25. */
  tenantConcurrency?: number;
};

/**
 * Drives every registered migration over every cohort tenant, once per
 * boot, several tenants at a time. Coordination is per ORGANIZATION, not
 * per process: each tenant is claimed under its own lease before any work,
 * so any number of processes (booting workers, an operator's targeted run)
 * share the fleet instead of standing down behind one fleet-wide driver -
 * a tenant already claimed elsewhere is simply left to its claim holder.
 * Level-triggered on the restart cadence: each pass re-attempts held and
 * parked tenants, so a tenant whose blocker was fixed heals itself with no
 * manual state change, and a pass that dies anywhere simply happens again
 * next boot.
 */
export class SystemMigrationRunnerService {
  constructor(private readonly deps: SystemMigrationRunnerDeps) {}

  /** One full pass. Always runs: tenants claimed by another process are
   *  counted in `claimed` and left alone rather than the pass standing
   *  down as a whole. */
  async runPass(args?: { signal?: AbortSignal }): Promise<MigrationPassSummary> {
    const signal = args?.signal;
    const summary: MigrationPassSummary = {
      tenantsSeen: 0,
      finalized: 0,
      held: 0,
      parked: 0,
      skipped: 0,
      claimed: 0,
    };
    if (this.deps.migrations.length === 0) return summary;

    await this.driveTenants({ summary, signal });
    if (summary.claimed > 0 && summary.claimed === summary.tenantsSeen) {
      // Every organization read as claimed. Genuine when another pass is
      // sweeping the same page at the same moment - but it is also the only
      // face an unreachable Redis wears (acquire fails safe to "held"), so
      // a pass that repeats this across boots deserves a line of evidence.
      logger.warn(
        { summary },
        "every organization was claimed by another process; if this repeats across boots, check Redis",
      );
    }
    logger.info({ summary }, "system migration pass complete");
    return summary;
  }

  /** Every cohort tenant, a page at a time, until abort. */
  private async driveTenants(args: {
    summary: MigrationPassSummary;
    signal?: AbortSignal;
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

  /** One page of tenants, worked by a bounded pool. False stops the pass. */
  private async drivePage({
    page,
    summary,
    signal,
  }: {
    page: string[];
    summary: MigrationPassSummary;
    signal?: AbortSignal;
  }): Promise<boolean> {
    const pending = [...page];
    const width = Math.min(
      Math.max(1, this.deps.tenantConcurrency ?? DEFAULT_TENANT_CONCURRENCY),
      pending.length,
    );
    const worker = async (): Promise<void> => {
      for (;;) {
        if (signal?.aborted) return;
        const tenantId = pending.shift();
        if (tenantId === undefined) return;
        try {
          await this.driveTenant({ tenantId, summary, signal });
        } catch (error) {
          // Contained here, not just around migrateTenant: a throw outside
          // that inner net (the state read, the cohort read) would reject
          // the pool's Promise.all, killing the pass while its surviving
          // workers drain on, detached and unobserved. The tenant stays
          // pending and the next pass retries it, like any park.
          summary.parked += 1;
          logger.error(
            { error, tenantId },
            "tenant drive failed outside the migration; continuing the pass",
          );
        }
      }
    };
    await Promise.all(Array.from({ length: width }, worker));
    return !signal?.aborted;
  }

  /**
   * One tenant, under its own claim. A tenant claimed by another process is
   * left to that process - its pass is running the very same migrations -
   * and one this pass claims runs its migrations in registration order,
   * heartbeat-renewed for as long as they take.
   */
  private async driveTenant({
    tenantId,
    summary,
    signal,
  }: {
    tenantId: string;
    summary: MigrationPassSummary;
    signal?: AbortSignal;
  }): Promise<void> {
    const { lease, cohort, migrations } = this.deps;
    summary.tenantsSeen += 1;

    const claimName = `${TENANT_CLAIM_PREFIX}${tenantId}`;
    const ttlMs = this.deps.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS;
    if (!(await lease.acquire({ name: claimName, ttlMs }))) {
      summary.claimed += 1;
      return;
    }

    // A single tenant can outlive the claim TTL on its own - one large
    // organization's parity sweep is a round trip per member - so the claim
    // is held by a timer for as long as its migrations run, not renewed
    // once between them.
    const heartbeat = this.startClaimHeartbeat(claimName);
    try {
      for (const migration of migrations) {
        if (signal?.aborted) return;
        if (heartbeat.claimLost()) {
          logger.warn(
            { tenantId },
            "organization claim lost mid-migration; leaving the rest of its migrations to the new holder",
          );
          return;
        }
        if (!(await cohort({ tenantId, migrationName: migration.name }))) {
          summary.skipped += 1;
          continue;
        }
        await this.runMigrationForTenant({
          migration,
          tenantId,
          signal,
          summary,
        });
      }
    } finally {
      heartbeat.stop();
      await lease.release({ name: claimName });
    }
  }

  /**
   * Keeps one tenant's claim alive while its migrations run. A renewal that
   * comes back false means another driver has legitimately taken the tenant
   * over, which this pass reads as "stop at this tenant's next migration" -
   * never as corruption, since every migration is idempotent. Other tenants
   * are unaffected: each holds its own claim.
   */
  private startClaimHeartbeat(claimName: string): {
    claimLost: () => boolean;
    stop: () => void;
  } {
    let lost = false;
    const ttlMs = this.deps.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS;
    const timer = setInterval(() => {
      void this.deps.lease
        .renew({ name: claimName, ttlMs })
        .then((held) => {
          if (!held) lost = true;
        })
        .catch(() => {
          lost = true;
        });
    }, this.deps.leaseRenewIntervalMs ?? DEFAULT_LEASE_RENEW_INTERVAL_MS);
    // Never let a heartbeat alone hold the process open at shutdown.
    timer.unref?.();
    return { claimLost: () => lost, stop: () => clearInterval(timer) };
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
    // Terminal states (`isTerminalTenantStatus`): `finalized` is the
    // one-way latch, and `rolled_back` is the operator's pin holding a
    // tenant on its legacy path. Re-running either would undo the
    // operator's decision on the very next boot.
    if (isTerminalTenantStatus(existing?.status)) {
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
      const wasWritten = await state.upsertRecordUnlessRolledBack({
        migrationName: migration.name,
        tenantId,
        status: outcome.status,
        report: outcome.report ?? null,
      });
      if (!wasWritten) {
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
