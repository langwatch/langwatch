/**
 * Generic calendar-scheduling types (ADR-044 Phase 1). The scheduler owns
 * durable cron entries and firing; handlers receive only identity triggers.
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
   * The calendar instant of the slot currently in flight; null when idle.
   * `nextRunAt` mutates into a lease/backoff instant once claimed, so THIS is
   * the slot identity a retry or crash-refire must hand the handler.
   */
  currentSlot: Date | null;
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
 * Persistence seam for the scheduler. Reads are cross-tenant global scans;
 * writes stay project-scoped and checked by the multitenancy guard.
 */
export interface ScheduledJobStore {
  /** Due-scan: active rows whose `nextRunAt <= now`, soonest first. */
  findDue(params: { now: Date; limit: number }): Promise<ScheduledJobRecord[]>;

  /**
   * MIN(nextRunAt) across active rows — the instant the loop sleeps until.
   * Null when nothing is scheduled (the loop falls back to its backstop).
   */
  earliestActiveNextRunAt(): Promise<Date | null>;

  /**
   * Atomically lease a due slot via conditional WHERE update; returns true iff
   * this worker won. Lease hides the slot until expiry, preventing double-claims.
   */
  claim(params: {
    id: string;
    projectId: string;
    expectedNextRunAt: Date;
    /**
     * The calendar instant this claim pins as the in-flight slot, distinct
     * from `expectedNextRunAt` (the WHERE guard): on a catch-up the guard is
     * the OLDEST missed slot, but this is the NEWEST — the one retries re-fire.
     */
    slot: Date;
    leaseUntil: Date;
  }): Promise<boolean>;
  // (claim stamps `currentSlot` via COALESCE with `slot`: the FIRST claim of a
  // slot records the calendar instant being fired; retry/lease re-claims — whose
  // `expectedNextRunAt` is a backoff or lease instant — preserve it.)

  /**
   * Resolve a lease via conditional update on the lease value; only the
   * lease-holder can settle. Service provides values for delivered/retry/abandoned.
   */
  settleClaim(params: {
    id: string;
    projectId: string;
    expectedLease: Date;
    nextRunAt: Date;
    lastSlot: Date | null;
    currentSlot: Date | null;
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
   * Every schedule a project owns for one consumer, so a product surface can
   * answer "when does this run next/last?" Project-scoped (unlike `findDue` /
   * `findForOps`), so it is safe under a customer-facing permission.
   */
  findAllForProject(params: {
    projectId: string;
    targetType: string;
  }): Promise<ScheduledJobRecord[]>;

  // Operator control (ADR-091): cross-tenant, gated on ops:manage, mutations
  // carry projectId as a fencing token to prevent stale operator actions.

  /** One schedule by id, across projects. Null when it no longer exists. */
  tryFindByIdForOps(params: { id: string }): Promise<ScheduledJobRecord | null>;

  /** Pause or resume a schedule. Never touches an in-flight slot. */
  setActiveForOps(params: { id: string; projectId: string; active: boolean }): Promise<boolean>;

  /**
   * Release a slot whose worker never settled it, making the schedule
   * claimable again: clears `currentSlot` and retry bookkeeping, and pulls
   * `nextRunAt` to now. Guarded on the lease instant the operator saw.
   */
  releaseSlotForOps(params: {
    id: string;
    projectId: string;
    expectedNextRunAt: Date;
    now: Date;
  }): Promise<boolean>;

  /**
   * Make a schedule due immediately; doesn't claim or execute. Racing the loop
   * is safe: conditional updates race and one wins.
   */
  requestImmediateRunForOps(params: {
    id: string;
    projectId: string;
    expectedNextRunAt: Date;
    now: Date;
  }): Promise<boolean>;

  // Refuses while a slot is claimed — see the note on the implementation. A
  // leased `nextRunAt` looks like an ordinary future timestamp, so without that
  // predicate an operator can re-arm a schedule whose worker is mid-run and the
  // target delivers twice.

  /**
   * Cross-tenant read for the ops dashboard: the most-imminent scheduled jobs
   * (active first, soonest `nextRunAt` first), bounded by `limit`. Read-only
   * operator visibility — never a firing path.
   */
  findForOps(params: { limit: number }): Promise<ScheduledJobRecord[]>;

  /**
   * Cross-tenant read of paused schedules with total for bounded pages.
   * Separate from findForOps to avoid sorting inactive rows to the end.
   */
  listPausedForOps(params: {
    limit: number;
  }): Promise<{ rows: ScheduledJobRecord[]; total: number }>;
}
