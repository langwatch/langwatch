/**
 * ADR-044 Phase 1 — the generic calendar-scheduling primitive's shared types.
 *
 * The scheduler is deliberately consumer-agnostic: it owns durable cron
 * entries (`ScheduledJob` rows) and firing; it knows nothing about reports,
 * dashboards, or graphs. A due job hands its registered handler only a tiny
 * identity trigger (`ScheduledJobFire`) — never a rendered payload — so the
 * handler re-derives everything fresh at fire time.
 */

/**
 * A durable scheduled-job row, decoupled from the Prisma model type so the
 * loop and repository interface don't leak `@prisma/client`. Field-for-field
 * identical to the `ScheduledJob` table (prisma/schema.prisma).
 */
export interface ScheduledJobRecord {
  id: string;
  projectId: string;
  /** The consumer key, e.g. "reportTrigger". */
  targetType: string;
  /** What to fire, e.g. the Trigger.id. */
  targetId: string;
  /** Cron expression, e.g. "0 9 * * 1". */
  cron: string;
  /** IANA timezone, e.g. "America/New_York". */
  timezone: string;
  /** Resolved UTC instant of the next fire (the forward marker). */
  nextRunAt: Date;
  /**
   * Last calendar instant DELIVERED; null until the first delivered fire.
   * Only advanced once a fire succeeds (see `settleClaim`), so a failed slot is
   * retried, not silently skipped.
   */
  lastSlot: Date | null;
  /**
   * Retry counter for the slot currently being worked. Bumped on each handler
   * failure and reset to 0 once the slot is delivered (or abandoned to the next
   * cron instant after the retry cap). The scheduler service owns the cap.
   */
  attempts: number;
  /** Last handler error message, for operator observability. Null when clean. */
  lastError: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * The tiny-trigger a due job hands its handler — an identity, never a
 * payload (ADR-044 §4 "tiny-trigger discipline"). `slot` is the calendar
 * instant being fired (the value of `nextRunAt` when the row came due).
 */
export interface ScheduledJobFire {
  projectId: string;
  targetType: string;
  targetId: string;
  slot: Date;
}

/** A registered consumer: runs when one of its `targetType`'s jobs is due. */
export type SchedulerHandler = (fire: ScheduledJobFire) => Promise<void>;

/**
 * Persistence seam for the scheduler (service → repository layering). A
 * Prisma-backed implementation lives in `scheduled-job.repository.ts`; the
 * loop depends only on this interface.
 *
 * The two reads (`findDue`, `earliestActiveNextRunAt`) are intentionally
 * CROSS-TENANT global scans — a single calendar scheduler serves every
 * project. The writes stay project-scoped (each carries `projectId`) so the
 * multitenancy guard (`dbMultiTenancyProtection`) is satisfied and no write
 * can touch the wrong tenant's row.
 */
export interface ScheduledJobRepository {
  /** Due-scan: active rows whose `nextRunAt <= now`, soonest first. */
  findDue(params: { now: Date; limit: number }): Promise<ScheduledJobRecord[]>;

  /**
   * MIN(nextRunAt) across active rows — the instant the loop sleeps until.
   * Null when nothing is scheduled (the loop falls back to its backstop).
   */
  earliestActiveNextRunAt(): Promise<Date | null>;

  /**
   * Atomically LEASE a due slot: a CONDITIONAL update
   * `WHERE id = :id AND projectId = :projectId AND nextRunAt = :expectedNextRunAt`
   * that pushes `nextRunAt` to `leaseUntil` (a near-future instant) and touches
   * NOTHING else — `lastSlot`, `attempts`, `lastError` are left as-is because
   * the slot is not yet delivered. Returns `true` iff this call won the lease —
   * exactly one of N racing workers can, because Postgres serialises the update
   * and the loser's WHERE no longer matches once the winner moves `nextRunAt`.
   *
   * Leasing (not advancing to the next cron slot) is what makes a failed fire
   * retryable: `findDue` selects `nextRunAt <= now`, so the leased row is
   * invisible to every worker — including this one — until the lease elapses.
   * That both stops a second worker double-claiming AND is the natural backoff
   * if this worker crashes before settling (the lease expires and the slot is
   * re-fired). The service advances the calendar only via `settleClaim` after a
   * delivered fire. This DB-level lease is the SOLE exactly-once mechanism (no
   * Redis leader-lock), which is what lets multiple workers scan and fire
   * concurrently to share load (ADR-044 §4 "No double-firing"). `projectId` is
   * included purely to satisfy the multitenancy guard; it is always the row's
   * own project, so it does not weaken the claim.
   */
  claim(params: {
    id: string;
    projectId: string;
    expectedNextRunAt: Date;
    leaseUntil: Date;
  }): Promise<boolean>;

  /**
   * Resolve a lease this worker holds: a CONDITIONAL update
   * `WHERE id = :id AND projectId = :projectId AND nextRunAt = :expectedLease`
   * that writes the next schedule + retry bookkeeping in one atomic step. The
   * guard is the lease value `claim` set, so only the lease-holder can settle
   * (a lease that expired and got re-claimed by another worker → 0 rows, this
   * call returns `false`). The SERVICE decides the values — this is a dumb
   * conditional writer that carries no retry policy:
   *   - delivered: `nextRunAt` = next cron instant, `lastSlot` = the slot,
   *     `attempts` = 0, `lastError` = null.
   *   - retry: `nextRunAt` = now + backoff, `lastSlot` unchanged (pass the
   *     row's existing value), `attempts` bumped, `lastError` = message.
   *   - abandoned / released: `nextRunAt` = next cron instant, `lastSlot`
   *     unchanged, `attempts` = 0.
   */
  settleClaim(params: {
    id: string;
    projectId: string;
    expectedLease: Date;
    nextRunAt: Date;
    lastSlot: Date | null;
    attempts: number;
    lastError: string | null;
  }): Promise<boolean>;

  /**
   * Create-or-update the single schedule for a target (keyed on the
   * `(targetType, targetId)` unique). Producers call this on create/edit;
   * an edit re-marks the row active and refreshes cron/tz/nextRunAt.
   */
  upsertForTarget(params: {
    projectId: string;
    targetType: string;
    targetId: string;
    cron: string;
    timezone: string;
    nextRunAt: Date;
  }): Promise<void>;

  /** Soft-delete: deactivate a target's schedule so the due-scan skips it. */
  deactivateForTarget(params: {
    projectId: string;
    targetType: string;
    targetId: string;
  }): Promise<void>;

  /**
   * Every schedule a project owns for one consumer — the read that lets a
   * product surface answer "when does this next run, and when did it last
   * run?" without sending the customer to the cross-tenant ops dashboard.
   * Project-scoped (unlike `findDue` / `listForOps`), so it is safe to expose
   * under a customer-facing permission.
   */
  findAllForProject(params: {
    projectId: string;
    targetType: string;
  }): Promise<ScheduledJobRecord[]>;

  /**
   * Cross-tenant read for the ops dashboard: the most-imminent scheduled jobs
   * (active first, soonest `nextRunAt` first), bounded by `limit`. Read-only
   * operator visibility — never a firing path.
   */
  listForOps(params: { limit: number }): Promise<ScheduledJobRecord[]>;
}
