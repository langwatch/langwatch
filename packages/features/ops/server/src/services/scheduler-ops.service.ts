import { createLogger } from "@langwatch/observability";
import type {
  OpsScheduledJob,
  SchedulerAuditEntryView,
  SchedulerControlAction,
} from "@langwatch/ops-contract";
import { SLOT_STALE_AFTER_MS } from "@langwatch/ops-contract";
import {
  ScheduleAlreadyInFlightError,
  ScheduleInactiveError,
  ScheduleNotFoundError,
  ScheduleRunInProgressError,
  ScheduleSlotNotStaleError,
} from "@langwatch/ops-contract";
import type { ProjectService } from "@langwatch/project-contract";
import { SchedulerAuditSink } from "../ports/scheduler-audit.sink";
import type {
  SchedulerOpsRepository,
  ScheduledJobRecord,
} from "../ports/scheduler-ops.repository";
import { SchedulerWakeService } from "../ports/scheduler-wake.service";

const logger = createLogger("langwatch:ops:scheduler");

/** Cross-tenant scheduler controls; manual runs only make work due. */
export class SchedulerOpsService {
  private constructor(
    private readonly repository: SchedulerOpsRepository,
    private readonly audit: SchedulerAuditSink,
    private readonly wake: SchedulerWakeService,
    private readonly projects: ProjectService,
  ) {}

  static create(input: {
    repository: SchedulerOpsRepository;
    audit: SchedulerAuditSink;
    wake: SchedulerWakeService;
    projects: ProjectService;
  }): SchedulerOpsService {
    return new SchedulerOpsService(
      input.repository,
      input.audit,
      input.wake,
      input.projects,
    );
  }

  async listScheduledJobs({
    limit = 200,
  }: {
    limit?: number;
  }): Promise<OpsScheduledJob[]> {
    const rows = await this.repository.listForOps({
      limit: Math.min(Math.max(limit, 1), 500),
    });

    const names = await this.resolveProjectNames(rows);

    return rows.map((row) =>
      toOpsScheduledJob({
        row,
        projectName: names.get(row.projectId) ?? null,
      }),
    );
  }

  /** Returns inactive schedules separately: the main listing is active-first. */
  async listPausedSchedules({
    limit = 50,
  }: {
    limit?: number;
  }): Promise<{ schedules: OpsScheduledJob[]; total: number }> {
    const { rows, total } = await this.repository.listPausedForOps({
      limit: Math.min(Math.max(limit, 1), 200),
    });

    const names = await this.resolveProjectNames(rows);

    return {
      total,
      schedules: rows.map((row) =>
        toOpsScheduledJob({
          row,
          projectName: names.get(row.projectId) ?? null,
        }),
      ),
    };
  }

  /** Recent operator actions, newest first. Empty when nothing is recorded. */
  async listRecentActions({
    limit = 20,
  }: {
    limit?: number;
  }): Promise<SchedulerAuditEntryView[]> {
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
    const row = await this.getSchedule(scheduleId);
    const applied = await this.repository.setActiveForOps({
      id: scheduleId,
      projectId: row.projectId,
      active,
    });
    if (!applied) {
      this.refuse({ error: new ScheduleNotFoundError(), scheduleId });
    }

    await this.record({
      actorUserId,
      action: active ? "ops.scheduler.resume" : "ops.scheduler.pause",
      row,
    });
    return this.readBack(scheduleId);
  }

  /** Releases only a stale slot, never a live worker. */
  async clearStuckSlot({
    scheduleId,
    actorUserId,
    now = new Date(),
  }: {
    scheduleId: string;
    actorUserId: string;
    now?: Date;
  }): Promise<OpsScheduledJob> {
    const row = await this.getSchedule(scheduleId);
    if (!row.currentSlot) {
      this.refuse({ error: new ScheduleSlotNotStaleError(), scheduleId });
    }

    const heldForMs = now.getTime() - row.updatedAt.getTime();
    if (heldForMs < SLOT_STALE_AFTER_MS) {
      this.refuse({ error: new ScheduleSlotNotStaleError(), scheduleId });
    }

    const released = await this.repository.releaseSlotForOps({
      id: scheduleId,
      projectId: row.projectId,
      expectedNextRunAt: row.nextRunAt,
      now,
    });
    if (!released) {
      this.refuse({ error: new ScheduleAlreadyInFlightError(), scheduleId });
    }

    await this.record({
      actorUserId,
      action: "ops.scheduler.clear_slot",
      row,
    });
    this.wake.wake();
    return this.readBack(scheduleId);
  }

  /** Makes work due; the scheduler loop still claims and runs it. */
  async runNow({
    scheduleId,
    actorUserId,
    now = new Date(),
  }: {
    scheduleId: string;
    actorUserId: string;
    now?: Date;
  }): Promise<OpsScheduledJob> {
    const row = await this.getSchedule(scheduleId);
    if (!row.active) {
      this.refuse({ error: new ScheduleInactiveError(), scheduleId });
    }
    if (row.currentSlot) {
      this.refuse({ error: new ScheduleRunInProgressError(), scheduleId });
    }

    const queued = await this.repository.requestImmediateRunForOps({
      id: scheduleId,
      projectId: row.projectId,
      expectedNextRunAt: row.nextRunAt,
      now,
    });
    if (!queued) {
      const current = await this.repository.tryFindByIdForOps({ id: scheduleId });
      if (current && !current.active) {
        this.refuse({ error: new ScheduleInactiveError(), scheduleId });
      }
      if (current?.currentSlot) {
        this.refuse({ error: new ScheduleRunInProgressError(), scheduleId });
      }
      this.refuse({ error: new ScheduleAlreadyInFlightError(), scheduleId });
    }

    await this.record({ actorUserId, action: "ops.scheduler.run_now", row });
    this.wake.wake();
    return this.readBack(scheduleId);
  }

  private async getSchedule(scheduleId: string): Promise<ScheduledJobRecord> {
    const row = await this.repository.tryFindByIdForOps({ id: scheduleId });
    if (!row) {
      this.refuse({ error: new ScheduleNotFoundError(), scheduleId });
    }
    return row;
  }

  private refuse({ error, scheduleId }: { error: Error; scheduleId: string }): never {
    logger.info({ scheduleId, code: error.name }, "Refused scheduler operator control");
    throw error;
  }

  private async readBack(scheduleId: string): Promise<OpsScheduledJob> {
    const row = await this.getSchedule(scheduleId);
    const names = await this.resolveProjectNames([row]);
    return toOpsScheduledJob({
      row,
      projectName: names.get(row.projectId) ?? null,
    });
  }

  /** Audit failures do not undo a completed control. */
  private async record({
    actorUserId,
    action,
    row,
  }: {
    actorUserId: string;
    action: SchedulerControlAction;
    row: ScheduledJobRecord;
  }): Promise<void> {
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

  private async resolveProjectNames(
    rows: readonly ScheduledJobRecord[],
  ): Promise<Map<string, string>> {
    const projectIds = [...new Set(rows.map((row) => row.projectId))];

    try {
      const projects = await this.projects.listNamesByIds({ projectIds });
      return new Map(projects.map((project) => [project.id, project.name]));
    } catch {
      return new Map();
    }
  }
}

function toOpsScheduledJob({
  row,
  projectName,
}: {
  row: ScheduledJobRecord;
  projectName: string | null;
}): OpsScheduledJob {
  return {
    id: row.id,
    projectName,
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
