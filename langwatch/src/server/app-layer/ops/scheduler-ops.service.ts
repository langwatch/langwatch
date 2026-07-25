import type {
  ScheduledJobRecord,
  ScheduledJobRepository,
} from "../scheduler/scheduler.types";

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
 * Read-only ops surface over the calendar scheduler (ADR-044). Exposes the
 * durable `ScheduledJob` rows to the ops dashboard so an operator can see what
 * is scheduled, when it next fires, and when it last fired — never a firing
 * path. Cross-tenant by design (one scheduler serves every project); the read
 * is gated by the `ops:view` permission at the router.
 */
export class SchedulerOpsService {
  constructor(private readonly repo: ScheduledJobRepository) {}

  async listScheduledJobs({
    limit = 200,
  }: {
    limit?: number;
  }): Promise<OpsScheduledJob[]> {
    const rows = await this.repo.listForOps({
      limit: Math.min(Math.max(limit, 1), 500),
    });
    return rows.map(toOpsScheduledJob);
  }
}

function toOpsScheduledJob(row: ScheduledJobRecord): OpsScheduledJob {
  return {
    id: row.id,
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
