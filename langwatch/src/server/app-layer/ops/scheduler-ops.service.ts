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
}

/**
 * Read-only ops surface over the calendar scheduler (ADR-042). Exposes the
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
  };
}
