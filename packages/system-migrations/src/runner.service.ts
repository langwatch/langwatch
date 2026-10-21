import { runOutsideDelivery } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import type { Instant } from "@langwatch/time";

import type { MigrationLeaseRepository } from "./lease.repository.ts";
import {
  SystemMigrationRecordNotFoundError,
  type SystemMigrationStateRepository,
} from "./state.repository.ts";
import type { SystemMigration } from "./system-migration.ts";
import type { TenantSource } from "./tenant-source.ts";
import {
  type HeldReason,
  isTerminalTenantStatus,
  isWaitingOnPerson,
  type MigrationPassSummary,
  type TenantMigrationOutcome,
  type TenantMigrationRecord,
} from "./types.ts";

const logger = createLogger("langwatch:system-migrations");

const TENANT_PAGE_SIZE = 100;

/** One claim per organization: `system-migrations:lease:` + this + the id. */
const TENANT_CLAIM_PREFIX = "tenant:";
const DEFAULT_LEASE_TTL_MS = 60_000;
/** Renew well inside the TTL so one slow round trip cannot drop the claim. */
const DEFAULT_LEASE_RENEW_INTERVAL_MS = 20_000;
/** How many organizations one pass works at once: caps claim heartbeats and
 *  convergence polls, not throughput - each tenant's own claim keeps one
 *  large import from holding the rest of the fleet behind it. */
const DEFAULT_TENANT_CONCURRENCY = 25;
const DEFAULT_PACING_WAIT_MS = 5_000;
/** On a queue list, a migration declaring no `pauseWhileQueuedAbove` waits at this many jobs. */
export const DEFAULT_PAUSE_WHILE_QUEUED_ABOVE = 5_000;
/** How long a paced pass's own queue work may stand still before the pass stops waiting on it. */
const PASS_QUEUE_WAIT_MS = 5 * 60_000;

/** A listed queue run as a paced pass sees it: room for its own jobs, never the whole queue's. */
export type PassQueueRun = Readonly<{
  waitForRoom: (input: { maxOutstanding: number; signal?: AbortSignal }) => Promise<void>;
}>;

/** A page's terminal statuses: tenant id, then migration name. */
type FinishedOnPage = Map<string, Map<string, TenantMigrationRecord["status"]>>;

/**
 * Which (tenant, migration) pairs a pass may touch, read fresh each pass. A
 * pair outside the cohort gets no state record - "not started" and "not in
 * the cohort yet" are the same pending state, so a rollout can widen later.
 */
export type MigrationCohort = ((args: {
  tenantId: string;
  migrationName: string;
}) => boolean | Promise<boolean>) & {
  /** Reads what a page of tenants needs in one go, before the page is asked per tenant. */
  prepare?: (args: { tenantIds: readonly string[] }) => Promise<void>;
};

export type SystemMigrationRunnerDeps = {
  state: SystemMigrationStateRepository;
  lease: MigrationLeaseRepository;
  tenants: TenantSource;
  cohort: MigrationCohort;
  migrations: readonly SystemMigration[];
  /** The clock a held tenant's `heldSince` is read from. */
  now: () => Instant;
  /** How long each claim grant lasts. Defaults to a minute. */
  leaseTtlMs?: number;
  /** How often a held claim renews. Must stay well inside the TTL. */
  leaseRenewIntervalMs?: number;
  /** How many organizations to migrate concurrently. Defaults to 25. */
  tenantConcurrency?: number;
  /**
   * The group queues' waiting-job count, read before each page a paced migration drives. Omitted,
   * the runner cannot pace; a throw reads as over the limit, never as empty.
   */
  queuedJobs?: () => Promise<number>;
  /** How long a paced page waits before reading the count again. Defaults to five seconds. */
  pacingWaitMs?: number;
  /**
   * Runs a paced pass on a queue list of its own: its jobs run ahead of any backlog, and each page
   * waits only for the pass's own outstanding jobs, never the queue's total (Alex, 2026-10-12).
   */
  runListedWork?: <Result>(input: {
    name: string;
    timeoutMs: number;
    work: (list?: PassQueueRun) => Promise<Result>;
  }) => Promise<Result>;
};

/**
 * Drives every registered migration over every cohort tenant, each claimed
 * under its own lease so any number of processes share the fleet.
 * Level-triggered: passes run until `MigrationPassSummary.advanced` stops.
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
      alreadyFinalized: 0,
      alreadyRolledBack: 0,
      claimed: 0,
      advanced: 0,
    };
    if (this.deps.migrations.length === 0) return summary;

    await this.driveOnOwnList({ summary, signal });
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

  /**
   * Whether an eligible tenant (this runner's source, inside the cohort) holds no finished row for
   * `migrationName` (a steady step's `migrated`, or a hold waiting on a person, counts as finished).
   * Read from state, never a pass: a tenant claimed elsewhere, or by nobody, counts until finished.
   */
  async hasUnfinishedTenant({ migrationName }: { migrationName: string }): Promise<boolean> {
    let cursor: string | null = null;
    for (;;) {
      const page = await this.deps.tenants.findTenantIdsAfter({ cursor, limit: TENANT_PAGE_SIZE });
      if (page.length === 0) return false;
      cursor = page[page.length - 1] ?? null;
      await this.deps.cohort.prepare?.({ tenantIds: page });
      const eligible: string[] = [];
      for (const tenantId of page) {
        if (await this.deps.cohort({ tenantId, migrationName })) eligible.push(tenantId);
      }
      if (eligible.length === 0) continue;
      const records = await this.deps.state.findRecords({ migrationName, tenantIds: eligible });
      const steady = this.deps.migrations.some(
        (migration) => migration.name === migrationName && migration.migratedIsSteady,
      );
      const finished = new Set(
        records
          .filter(
            (record) =>
              isTerminalTenantStatus(record.status) ||
              (steady && record.status === "migrated") ||
              isWaitingOnPerson(record),
          )
          .map((r) => r.tenantId),
      );
      if (eligible.some((tenantId) => !finished.has(tenantId))) return true;
    }
  }

  /**
   * A pass with a queue runs on a list of its own, paced by default; one whose work stops draining
   * keeps what it recorded and leaves the rest to the next pass, which is level-triggered.
   */
  private async driveOnOwnList(args: {
    summary: MigrationPassSummary;
    signal?: AbortSignal;
  }): Promise<void> {
    const { runListedWork } = this.deps;
    if (runListedWork === undefined) return this.driveTenants(args);
    const names = this.deps.migrations.map((migration) => migration.name).join(",");
    // Only the queue's own refusals (its wait for room, its closing wait) leave the rest to the
    // next pass; a failed tenant read or claim fails the pass as it does off the list.
    let queueRefused = false;
    let driveFailure: { error: unknown } | undefined;
    const work = async (list?: PassQueueRun): Promise<void> => {
      const watched: PassQueueRun | undefined = list && {
        waitForRoom: (input) =>
          list.waitForRoom(input).catch((error: unknown) => {
            queueRefused = true;
            throw error;
          }),
      };
      await this.driveTenants({ ...args, list: watched }).catch((error: unknown) => {
        if (!queueRefused) driveFailure = { error };
        throw error;
      });
    };
    try {
      await runListedWork({
        name: `system-migrations:${names}:${crypto.randomUUID()}`,
        timeoutMs: PASS_QUEUE_WAIT_MS,
        work,
      });
    } catch (error) {
      if (driveFailure) throw driveFailure.error;
      logger.warn(
        { error, migrations: names },
        "the pass's own queue work did not drain; the next pass picks up where it stopped",
      );
    }
  }

  /** The strictest declared pacing limit among the pass's migrations; undefined when none does. */
  private pacingLimit(): number | undefined {
    const limits = this.deps.migrations.flatMap((migration) =>
      migration.pauseWhileQueuedAbove === undefined ? [] : [migration.pauseWhileQueuedAbove],
    );
    return limits.length === 0 ? undefined : Math.min(...limits);
  }

  /** On a queue list every migration is paced: one that declares no limit takes the default. */
  private listPacingLimit(): number {
    return Math.min(
      ...this.deps.migrations.map(
        (migration) => migration.pauseWhileQueuedAbove ?? DEFAULT_PAUSE_WHILE_QUEUED_ABOVE,
      ),
    );
  }

  /** Every cohort tenant, a page at a time, until abort. */
  private async driveTenants(args: {
    summary: MigrationPassSummary;
    signal?: AbortSignal;
    list?: PassQueueRun;
  }): Promise<void> {
    let cursor: string | null = null;
    for (;;) {
      const page = await this.deps.tenants.findTenantIdsAfter({
        cursor,
        limit: TENANT_PAGE_SIZE,
      });
      if (page.length === 0) return;
      cursor = page[page.length - 1] ?? null;
      if (!(await this.waitForQueueRoom({ signal: args.signal, list: args.list }))) return;
      if (!(await this.drivePage({ ...args, page }))) return;
    }
  }

  /**
   * Holds the next page while more of the pass's own jobs wait than its strictest migration allows;
   * with no list, while the whole queue holds more than a declared limit. False means aborted.
   */
  private async waitForQueueRoom({
    signal,
    list,
  }: {
    signal?: AbortSignal;
    list?: PassQueueRun;
  }): Promise<boolean> {
    if (list) {
      const maxOutstanding = this.listPacingLimit();
      await list.waitForRoom({ maxOutstanding, ...(signal ? { signal } : {}) });
      return !signal?.aborted;
    }
    const limit = this.pacingLimit();
    const { queuedJobs } = this.deps;
    if (limit === undefined || queuedJobs === undefined) return !signal?.aborted;
    for (;;) {
      if (signal?.aborted) return false;
      const queued = await queuedJobs().catch((error: unknown) => {
        logger.warn(
          { error },
          "could not read the queue depth; pacing as if it were over the limit",
        );
        return Number.POSITIVE_INFINITY;
      });
      if (queued <= limit) return true;
      logger.info(
        { queued, limit },
        "queue over the pacing limit; holding the next page of tenants",
      );
      await pause({ ms: this.deps.pacingWaitMs ?? DEFAULT_PACING_WAIT_MS, signal });
    }
  }

  /** One page of tenants, worked by a bounded pool. False stops the pass. */
  private async drivePage({
    page,
    summary,
    signal,
    list,
  }: {
    page: string[];
    summary: MigrationPassSummary;
    signal?: AbortSignal;
    list?: PassQueueRun;
  }): Promise<boolean> {
    // A failed read only costs the shortcut: every tenant then takes its claim, as before.
    const finished = await this.readFinished({ page }).catch((error: unknown) => {
      logger.warn({ error }, "could not read the page's finished tenants; claiming each one");
      return new Map() as FinishedOnPage;
    });
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
          await this.driveTenant({ tenantId, summary, signal, finished, list });
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
   * The page's terminal rows, one read per migration: a tenant whose every migration is finished
   * or out of the cohort is counted from these and takes no claim.
   */
  private async readFinished({ page }: { page: readonly string[] }): Promise<FinishedOnPage> {
    await this.deps.cohort.prepare?.({ tenantIds: page });
    const finished: FinishedOnPage = new Map();
    for (const migration of this.deps.migrations) {
      const records = await this.deps.state.findRecords({
        migrationName: migration.name,
        tenantIds: page,
      });
      for (const record of records) {
        if (!isTerminalTenantStatus(record.status)) continue;
        const statuses = finished.get(record.tenantId) ?? new Map();
        statuses.set(migration.name, record.status);
        finished.set(record.tenantId, statuses);
      }
    }
    return finished;
  }

  /** Counts a tenant with nothing left to run without claiming it; false when it has work. */
  private async countedAsFinished({
    tenantId,
    summary,
    finished,
  }: {
    tenantId: string;
    summary: MigrationPassSummary;
    finished: FinishedOnPage;
  }): Promise<boolean> {
    const statuses = finished.get(tenantId);
    if (!statuses) return false;
    const counts = { skipped: 0, alreadyFinalized: 0, alreadyRolledBack: 0 };
    for (const migration of this.deps.migrations) {
      const status = statuses.get(migration.name);
      if (status === "finalized") counts.alreadyFinalized += 1;
      else if (status === "rolled_back") counts.alreadyRolledBack += 1;
      else if (await this.deps.cohort({ tenantId, migrationName: migration.name })) return false;
      else counts.skipped += 1;
    }
    summary.skipped += counts.skipped;
    summary.alreadyFinalized += counts.alreadyFinalized;
    summary.alreadyRolledBack += counts.alreadyRolledBack;
    return true;
  }

  /**
   * One tenant, under its own claim. A tenant claimed elsewhere is left to
   * that process; one this pass claims runs its migrations in registration
   * order, heartbeat-renewed for as long as they take.
   */
  private async driveTenant({
    tenantId,
    summary,
    signal,
    finished,
    list,
  }: {
    tenantId: string;
    summary: MigrationPassSummary;
    signal?: AbortSignal;
    finished: FinishedOnPage;
    list?: PassQueueRun;
  }): Promise<void> {
    const { lease, cohort, migrations } = this.deps;
    summary.tenantsSeen += 1;
    if (await this.countedAsFinished({ tenantId, summary, finished })) return;

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
          list,
        });
      }
    } finally {
      heartbeat.stop();
      await lease.release({ name: claimName });
    }
  }

  /**
   * A renewal that comes back false means another driver has legitimately
   * taken the tenant over - read as "stop at this tenant's next migration",
   * never as corruption, since every migration is idempotent.
   */
  private startClaimHeartbeat(claimName: string): {
    claimLost: () => boolean;
    stop: () => void;
  } {
    let lost = false;
    const ttlMs = this.deps.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS;
    // A renewal is not the pass's progress: a hung tenant step must still go silent.
    const timer = runOutsideDelivery(() =>
      setInterval(() => {
        void this.deps.lease
          .renew({ name: claimName, ttlMs })
          .then((held) => {
            if (!held) lost = true;
          })
          .catch(() => {
            lost = true;
          });
      }, this.deps.leaseRenewIntervalMs ?? DEFAULT_LEASE_RENEW_INTERVAL_MS),
    );
    // Never let a heartbeat alone hold the process open at shutdown.
    timer.unref?.();
    return { claimLost: () => lost, stop: () => clearInterval(timer) };
  }

  private async runMigrationForTenant({
    migration,
    tenantId,
    signal,
    summary,
    list,
  }: {
    migration: SystemMigration;
    tenantId: string;
    signal?: AbortSignal;
    summary: MigrationPassSummary;
    list?: PassQueueRun;
  }): Promise<void> {
    const { state } = this.deps;
    const existing = await state
      .getRecord({ migrationName: migration.name, tenantId })
      .catch(undefinedWhenNotFound);
    // Terminal states (`isTerminalTenantStatus`): `finalized` is the
    // one-way latch, and `rolled_back` is the operator's pin holding a
    // tenant on its legacy path. Re-running either would undo the
    // operator's decision on the very next boot.
    if (isTerminalTenantStatus(existing?.status)) {
      if (existing?.status === "rolled_back") summary.alreadyRolledBack += 1;
      else summary.alreadyFinalized += 1;
      return;
    }

    try {
      const outcome = await migration.migrateTenant({
        tenantId,
        signal,
        // A migration that writes before it records anything needs to know
        // its last attempt died, so it can finish work the crash stranded.
        previous: existing,
        // The bound the pass holds between pages of tenants, offered between pages of commands.
        waitForRoom: async () => {
          await this.waitForQueueRoom({ signal, list });
        },
      });
      // Compare-and-set, not a blind upsert: an operator may have pinned the
      // row `rolled_back` while `migrateTenant` ran, and that pin outranks
      // anything this pass concluded. A refused write is the pin winning -
      // terminal for this tenant this pass; the row stays exactly as the
      // operator left it.
      const record: TenantMigrationRecord = {
        migrationName: migration.name,
        tenantId,
        status: outcome.status,
        report: outcome.report ?? null,
        ...heldFields({ migration, outcome, existing, now: this.deps.now }),
      };
      const wasWritten = await state.upsertRecordUnlessRolledBack(record);
      if (!wasWritten) {
        summary.skipped += 1;
        logger.warn(
          { migration: migration.name, tenantId, outcome: outcome.status },
          "an operator rolled the tenant back mid-pass; the pass's outcome is discarded",
        );
        return;
      }
      // The transition, not the outcome: a held tenant re-proved and
      // re-written `migrated` moved nowhere, and a caller looping until the
      // fleet stops moving has to be able to tell that apart. An absent
      // previous record is a transition - pending is a state.
      if (existing?.status !== outcome.status) summary.advanced += 1;
      if (outcome.status === "finalized") summary.finalized += 1;
      else if (outcome.status === "migrated") summary.held += 1;
      else summary.parked += 1;
      const { heldReason } = record;
      const fields = { migration: migration.name, tenantId, status: outcome.status };
      if (heldReason) {
        logger[heldNoticeLevel({ existing, heldReason })](
          { ...fields, heldReason },
          "tenant migration held; it stays on its legacy path and nothing waits on it",
        );
      } else logger.info(fields, "tenant migration outcome");
    } catch (error) {
      // Parked, never fatal: the tenant stays on its legacy path (behaviour
      // unchanged) and the next pass tries again. One broken tenant must
      // not stop the fleet.
      summary.parked += 1;
      await recordParkedTenant({ state, migration, tenantId, existing, error, summary });
      logger.error(
        { error, migration: migration.name, tenantId },
        "tenant migration parked on error",
      );
    }
  }
}

/**
 * A first hold is usually a projection still folding, and the next pass re-proves it, so it is
 * info; a tenant still held from an earlier pass is a warn, unless it waits on a person.
 */
export function heldNoticeLevel({
  existing,
  heldReason,
}: {
  existing: TenantMigrationRecord | undefined;
  heldReason?: HeldReason | undefined;
}): "info" | "warn" {
  return existing?.status === "migrated" && heldReason !== "person" ? "warn" : "info";
}

/** Held carries why and since when (the first moment, while still held); else neither. */
function heldFields({
  migration,
  outcome,
  existing,
  now,
}: {
  migration: SystemMigration;
  outcome: TenantMigrationOutcome;
  existing: TenantMigrationRecord | undefined;
  now: () => Instant;
}): Pick<TenantMigrationRecord, "heldReason" | "heldSince"> {
  // A steady step's `migrated` is its settled state, never a hold (`migratedIsSteady`).
  if (outcome.status !== "migrated" || migration.migratedIsSteady) return {};
  const heldSince = existing?.status === "migrated" ? existing.heldSince : undefined;
  return { heldReason: outcome.heldReason ?? "proof", heldSince: heldSince ?? now() };
}

async function recordParkedTenant({
  state,
  migration,
  tenantId,
  existing,
  error,
  summary,
}: {
  state: SystemMigrationStateRepository;
  migration: SystemMigration;
  tenantId: string;
  existing: TenantMigrationRecord | undefined;
  error: unknown;
  summary: MigrationPassSummary;
}): Promise<void> {
  try {
    // The same compare-and-set as the outcome write: a `parked` row that
    // replaced an operator's `rolled_back` pin would be retried on the
    // next pass and re-finalized, undoing the rollback. A refused park
    // costs nothing - the pin already keeps the tenant off every later
    // pass.
    const parkWritten = await state.upsertRecordUnlessRolledBack({
      migrationName: migration.name,
      tenantId,
      status: "parked",
      report: {
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
      },
    });
    // Newly parked is a transition; a tenant parked again for the same
    // reason is not, or a permanently broken tenant would keep a
    // convergence loop running forever.
    if (parkWritten && existing?.status !== "parked") {
      summary.advanced += 1;
    }
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
}

function undefinedWhenNotFound(error: unknown): undefined {
  if (error instanceof SystemMigrationRecordNotFoundError) return undefined;
  throw error;
}

/** A wait that ends early, without throwing, when the pass is aborted. */
function pause({ ms, signal }: { ms: number; signal?: AbortSignal }): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done(): void {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}
