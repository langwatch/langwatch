import { createLogger } from "@langwatch/observability";
import type {
  ScheduledJobRecord,
  ScheduledJobRepository,
} from "../scheduler/scheduler.types";
import {
  ScheduleAlreadyInFlightError,
  ScheduleInactiveError,
  ScheduleNotFoundError,
  ScheduleSlotNotStaleError,
} from "./scheduler-control.errors";

const logger = createLogger("langwatch:ops:scheduler");

/** One scheduled job as the ops dashboard renders it (read-only view). */
export interface OpsScheduledJob {
  id: string;
  projectId: string;
  targetType: string;
  targetId: string;
  cron: string;
  timezone: string;
  nextRunAt: string;
  lastSlot: string | null;
  active: boolean;
  /** Display name of the owning project; null when it could not be resolved. */
  projectName: string | null;
  createdAt: string;
  /**
   * The slot currently being worked, or null when idle.
   *
   * This is the closest thing to "is a lock held" the scheduler can answer. It
   * has no lease-holder column, so a claimed slot is observable but the worker
   * holding it is not; a row stuck here with a rising `attempts` is a job
   * failing and retrying rather than one running long.
   */
  currentSlot: string | null;
  attempts: number;
  /** Last failure, so a stuck schedule explains itself without a log dive. */
  lastError: string | null;
  updatedAt: string;
}

/**
 * How long a claimed slot must sit untouched before clearing it is offered.
 *
 * Comfortably past the loop's lease window, so "stale" means the worker has
 * genuinely stopped rather than that it is mid-run. Offering the repair sooner
 * would invite an operator to race a healthy worker.
 */
export const SLOT_STALE_AFTER_MS = 15 * 60_000;

/** What a control did, for the audit trail. */
export type SchedulerControlAction =
  | "ops.scheduler.pause"
  | "ops.scheduler.resume"
  | "ops.scheduler.clear_slot"
  | "ops.scheduler.run_now";

/** Records who did what to which schedule. Failures never block the control. */
export interface SchedulerAuditSink {
  append(entry: {
    actorUserId: string;
    action: SchedulerControlAction;
    scheduleId: string;
    projectId: string;
    slot: Date | null;
  }): Promise<void>;
  listRecent?(params: { limit: number }): Promise<SchedulerAuditEntryView[]>;
}

/** One recorded operator action, as the page lists it. */
export interface SchedulerAuditEntryView {
  id: string;
  at: string;
  action: string;
  scheduleId: string;
  projectId: string | null;
  actor: string | null;
}

/**
 * Ops surface over the calendar scheduler (ADR-044, ADR-091).
 *
 * Cross-tenant by design: one scheduler serves every project. Reads are gated
 * on `ops:view`, controls on `ops:manage`.
 *
 * The controls are the narrower successor to this service's original "never a
 * firing path" rule. There is still no UNFENCED, UNAUDITED or UNGATED firing
 * path: a manual run does not invoke a target, it makes the schedule due and
 * lets the loop claim it through the same conditional-update lease a scheduled
 * fire uses. What the rule was protecting against was a hand-written Postgres
 * UPDATE, which is what an operator had to do instead.
 */
export class SchedulerOpsService {
  constructor(
    private readonly repo: ScheduledJobRepository,
    private readonly audit?: SchedulerAuditSink | null,
    /**
     * Best-effort poke so a manual run fires now rather than within one poll
     * backstop. Latency only — the loop picks the row up either way.
     */
    private readonly wake?: (() => void) | null,
    /** Maps project ids to names so rows and confirmations can say who. */
    private readonly resolveProjectNames?:
      | ((projectIds: string[]) => Promise<Map<string, string>>)
      | null,
  ) {}

  async listScheduledJobs({
    limit = 200,
  }: {
    limit?: number;
  }): Promise<OpsScheduledJob[]> {
    const rows = await this.repo.listForOps({
      limit: Math.min(Math.max(limit, 1), 500),
    });

    // Resolve names server-side. A row reading `project_LVYcVYGW1AJqvp2G8vcVd`
    // has told the operator nothing they can use and taken the width a name
    // would have needed — and every confirmation on this page has to name the
    // tenant, because acting on the wrong row is the realistic failure here.
    const names = this.resolveProjectNames
      ? await this.resolveProjectNames([
          ...new Set(rows.map((row) => row.projectId)),
        ]).catch(() => new Map<string, string>())
      : new Map<string, string>();

    return rows.map((row) => ({
      ...toOpsScheduledJob(row),
      projectName: names.get(row.projectId) ?? null,
    }));
  }

  /** Recent operator actions, newest first. Empty when nothing is recorded. */
  async listRecentActions({
    limit = 20,
  }: {
    limit?: number;
  }): Promise<SchedulerAuditEntryView[]> {
    if (!this.audit?.listRecent) return [];
    return this.audit.listRecent({ limit: Math.min(Math.max(limit, 1), 100) });
  }

  // ── Controls (ADR-091) ────────────────────────────────────────────────

  async setActive({
    scheduleId,
    active,
    actorUserId,
  }: {
    scheduleId: string;
    active: boolean;
    actorUserId: string;
  }): Promise<OpsScheduledJob> {
    const row = await this.requireSchedule(scheduleId);
    await this.repo.setActiveForOps({ id: scheduleId, active });
    await this.record({
      actorUserId,
      action: active ? "ops.scheduler.resume" : "ops.scheduler.pause",
      row,
    });
    return this.requireSchedule(scheduleId).then(toOpsScheduledJob);
  }

  /**
   * Release a slot whose worker stopped responding.
   *
   * Refuses while the slot is still current: this is a repair for a wedged
   * schedule, not a general-purpose cancel, and clearing a live slot is the one
   * way it could admit a second worker to the same work.
   */
  async clearStuckSlot({
    scheduleId,
    actorUserId,
    now = new Date(),
  }: {
    scheduleId: string;
    actorUserId: string;
    now?: Date;
  }): Promise<OpsScheduledJob> {
    const row = await this.requireSchedule(scheduleId);
    if (!row.currentSlot) throw new ScheduleSlotNotStaleError(scheduleId);

    const heldForMs = now.getTime() - row.updatedAt.getTime();
    if (heldForMs < SLOT_STALE_AFTER_MS) {
      throw new ScheduleSlotNotStaleError(scheduleId);
    }

    const released = await this.repo.releaseSlotForOps({
      id: scheduleId,
      expectedNextRunAt: row.nextRunAt,
      now,
    });
    if (!released) throw new ScheduleAlreadyInFlightError(scheduleId);

    await this.record({
      actorUserId,
      action: "ops.scheduler.clear_slot",
      row,
    });
    this.wake?.();
    return this.requireSchedule(scheduleId).then(toOpsScheduledJob);
  }

  /**
   * Make a schedule due now and let the loop run it.
   *
   * The manual run is not executed here: pulling `nextRunAt` forward hands the
   * slot to the ordinary due-scan, so it is claimed and run through exactly the
   * path a scheduled fire takes. That is what makes racing the loop safe and
   * what keeps a manual run visible as a run.
   */
  async runNow({
    scheduleId,
    actorUserId,
    now = new Date(),
  }: {
    scheduleId: string;
    actorUserId: string;
    now?: Date;
  }): Promise<OpsScheduledJob> {
    const row = await this.requireSchedule(scheduleId);
    // A paused schedule refuses rather than firing once out of band — the whole
    // point of pausing is that nothing runs.
    if (!row.active) throw new ScheduleInactiveError(scheduleId);

    const queued = await this.repo.requestImmediateRunForOps({
      id: scheduleId,
      expectedNextRunAt: row.nextRunAt,
      now,
    });
    if (!queued) throw new ScheduleAlreadyInFlightError(scheduleId);

    await this.record({ actorUserId, action: "ops.scheduler.run_now", row });
    this.wake?.();
    return this.requireSchedule(scheduleId).then(toOpsScheduledJob);
  }

  private async requireSchedule(
    scheduleId: string,
  ): Promise<ScheduledJobRecord> {
    const row = await this.repo.findByIdForOps({ id: scheduleId });
    if (!row) throw new ScheduleNotFoundError(scheduleId);
    return row;
  }

  /**
   * Audit is best-effort and never fails the control: the mutation has already
   * landed by this point, so throwing here would report a failure that did not
   * happen and invite the operator to do it twice.
   */
  private async record({
    actorUserId,
    action,
    row,
  }: {
    actorUserId: string;
    action: SchedulerControlAction;
    row: ScheduledJobRecord;
  }): Promise<void> {
    if (!this.audit) return;
    try {
      await this.audit.append({
        actorUserId,
        action,
        scheduleId: row.id,
        projectId: row.projectId,
        slot: row.currentSlot ?? row.nextRunAt,
      });
    } catch (error) {
      logger.warn(
        { error, action, scheduleId: row.id },
        "Failed to record scheduler operator action",
      );
    }
  }
}

function toOpsScheduledJob(row: ScheduledJobRecord): OpsScheduledJob {
  return {
    id: row.id,
    projectName: null,
    projectId: row.projectId,
    targetType: row.targetType,
    targetId: row.targetId,
    cron: row.cron,
    timezone: row.timezone,
    nextRunAt: row.nextRunAt.toISOString(),
    lastSlot: row.lastSlot ? row.lastSlot.toISOString() : null,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
    currentSlot: row.currentSlot ? row.currentSlot.toISOString() : null,
    attempts: row.attempts,
    lastError: row.lastError ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}
