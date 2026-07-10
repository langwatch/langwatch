/**
 * ADR-042 Phase 1 — the generic calendar-scheduling primitive's shared types.
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
  /** Last calendar instant fired; null until the first fire. */
  lastSlot: Date | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * The tiny-trigger a due job hands its handler — an identity, never a
 * payload (ADR-042 §4 "tiny-trigger discipline"). `slot` is the calendar
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
   * Atomically claim a due slot: a CONDITIONAL update
   * `WHERE id = :id AND projectId = :projectId AND nextRunAt = :expectedNextRunAt`
   * that advances `nextRunAt` and records `lastSlot`. Returns `true` iff this
   * call won the claim — exactly one of N racing workers can, because Postgres
   * serialises the update and the loser's WHERE no longer matches once the
   * winner flips `nextRunAt`. This DB-level claim is the SOLE exactly-once
   * mechanism (no Redis leader-lock), which is what lets multiple workers scan
   * and fire concurrently to share load (ADR-042 §4 "No double-firing").
   * `projectId` is included purely to satisfy the multitenancy guard; it is
   * always the row's own project, so it does not weaken the claim.
   */
  claim(params: {
    id: string;
    projectId: string;
    expectedNextRunAt: Date;
    nextRunAt: Date;
    lastSlot: Date;
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
}
