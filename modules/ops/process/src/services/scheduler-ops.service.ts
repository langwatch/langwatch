import type { AutomationApi, OperatorReportSchedule } from "@langwatch/automation-contract";
import { createLogger } from "@langwatch/observability";
import {
  ScheduleInactiveError,
  ScheduleNotFoundError,
  ScheduleRunInProgressError,
  ScheduleSlotNotStaleError,
  SLOT_STALE_AFTER_MS,
  type OpsScheduledJob,
  type SchedulerAuditEntryView,
  type SchedulerControlAction,
} from "@langwatch/ops-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { nowInstant } from "@langwatch/time";

import type { SchedulerAuditRepository } from "../repositories/ops-audit.repository.ts";

const logger = createLogger("langwatch:ops:scheduler");

/** Main's scheduler named a report's schedule by this target type. */
const REPORT_TARGET_TYPE = "reportTrigger";

type ReportSchedules = Pick<
  AutomationApi,
  "findAllReportSchedules" | "setReportScheduleActive" | "requestReportRun" | "clearReportRun"
>;

/** The operator view over automation's report schedules; every control is an automation command. */
export class SchedulerOpsService {
  private readonly schedules: ReportSchedules;
  private readonly audit: SchedulerAuditRepository;
  private readonly projects: Pick<ProjectApi, "listNamesByIds">;

  private constructor(deps: {
    schedules: ReportSchedules;
    audit: SchedulerAuditRepository;
    projects: Pick<ProjectApi, "listNamesByIds">;
  }) {
    this.schedules = deps.schedules;
    this.audit = deps.audit;
    this.projects = deps.projects;
  }

  static create(input: {
    schedules: ReportSchedules;
    audit: SchedulerAuditRepository;
    projects: Pick<ProjectApi, "listNamesByIds">;
  }): SchedulerOpsService {
    return new SchedulerOpsService(input);
  }

  async listScheduledJobs({ limit = 200 }: { limit?: number }): Promise<OpsScheduledJob[]> {
    const rows = (await this.findOrdered()).slice(0, Math.min(Math.max(limit, 1), 500));

    return this.present(rows);
  }

  /** Returns inactive schedules separately: the main listing is active-first. */
  async listPausedSchedules({
    limit = 50,
  }: {
    limit?: number;
  }): Promise<{ schedules: OpsScheduledJob[]; total: number }> {
    const paused = (await this.findOrdered()).filter((row) => !row.active);

    return {
      total: paused.length,
      schedules: await this.present(paused.slice(0, Math.min(Math.max(limit, 1), 200))),
    };
  }

  /** Recent operator actions, newest first. Empty when nothing is recorded. */
  async listRecentActions({ limit = 20 }: { limit?: number }): Promise<SchedulerAuditEntryView[]> {
    return this.audit.findRecent({ limit: Math.min(Math.max(limit, 1), 100) });
  }

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
    await this.schedules.setReportScheduleActive({
      projectId: row.projectId,
      triggerId: row.triggerId,
      active,
    });

    await this.record({
      actorUserId,
      action: active ? "ops.scheduler.resume" : "ops.scheduler.pause",
      row,
    });

    return this.readBack(scheduleId);
  }

  /** Releases only a run held past the staleness threshold, never a live one. */
  async clearStuckSlot({
    scheduleId,
    actorUserId,
    now = nowInstant().epochMilliseconds,
  }: {
    scheduleId: string;
    actorUserId: string;
    now?: number;
  }): Promise<OpsScheduledJob> {
    const row = await this.getSchedule(scheduleId);
    if (!row.running || now - row.running.since.getTime() < SLOT_STALE_AFTER_MS) {
      return this.refuse({ error: new ScheduleSlotNotStaleError(), scheduleId });
    }

    await this.schedules.clearReportRun({
      projectId: row.projectId,
      triggerId: row.triggerId,
      requestId: row.running.requestId,
    });
    await this.record({ actorUserId, action: "ops.scheduler.clear_slot", row });

    return this.readBack(scheduleId);
  }

  /** Asks automation for one extra send; refused while any run is still in flight. */
  async runNow({
    scheduleId,
    actorUserId,
  }: {
    scheduleId: string;
    actorUserId: string;
  }): Promise<OpsScheduledJob> {
    const row = await this.getSchedule(scheduleId);
    if (!row.active) {
      this.refuse({ error: new ScheduleInactiveError(), scheduleId });
    }
    if (row.running) {
      this.refuse({ error: new ScheduleRunInProgressError(), scheduleId });
    }

    await this.schedules.requestReportRun({ projectId: row.projectId, triggerId: row.triggerId });
    await this.record({ actorUserId, action: "ops.scheduler.run_now", row });

    return this.readBack(scheduleId);
  }

  private async findOrdered(): Promise<OperatorReportSchedule[]> {
    return (await this.schedules.findAllReportSchedules()).toSorted(compareActiveThenSoonest);
  }

  private async getSchedule(scheduleId: string): Promise<OperatorReportSchedule> {
    const rows = await this.schedules.findAllReportSchedules();
    const row = rows.find((candidate) => candidate.triggerId === scheduleId);
    if (!row) {
      return this.refuse({ error: new ScheduleNotFoundError(), scheduleId });
    }

    return row;
  }

  private refuse({ error, scheduleId }: { error: Error; scheduleId: string }): never {
    logger.info({ scheduleId, code: error.name }, "Refused scheduler operator control");

    throw error;
  }

  /** The schedule as automation holds it now; its process applies the command shortly after. */
  private async readBack(scheduleId: string): Promise<OpsScheduledJob> {
    const [job] = await this.present([await this.getSchedule(scheduleId)]);
    if (!job) {
      return this.refuse({ error: new ScheduleNotFoundError(), scheduleId });
    }

    return job;
  }

  /** Audit failures do not undo a completed control. */
  private async record({
    actorUserId,
    action,
    row,
  }: {
    actorUserId: string;
    action: SchedulerControlAction;
    row: OperatorReportSchedule;
  }): Promise<void> {
    try {
      await this.audit.append({
        actorUserId,
        action,
        scheduleId: row.triggerId,
        projectId: row.projectId,
        slot: row.nextRunAt?.toISOString() ?? null,
      });
    } catch (error) {
      logger.warn(
        { error, action, scheduleId: row.triggerId },
        "Failed to record scheduler operator action",
      );
    }
  }

  private async present(rows: readonly OperatorReportSchedule[]): Promise<OpsScheduledJob[]> {
    const names = await this.resolveProjectNames(rows);

    return rows.map((row) =>
      toOpsScheduledJob({ row, projectName: names.get(row.projectId) ?? null }),
    );
  }

  private async resolveProjectNames(
    rows: readonly OperatorReportSchedule[],
  ): Promise<Map<string, string>> {
    const projectIds = [...new Set(rows.map((row) => row.projectId))];
    if (projectIds.length === 0) return new Map();

    try {
      const projects = await this.projects.listNamesByIds({ projectIds });

      return new Map(projects.map((project) => [project.id, project.name]));
    } catch {
      return new Map();
    }
  }
}

function compareActiveThenSoonest(
  left: OperatorReportSchedule,
  right: OperatorReportSchedule,
): number {
  if (left.active !== right.active) return left.active ? -1 : 1;
  const leftAt = left.nextRunAt?.getTime() ?? Number.POSITIVE_INFINITY;
  const rightAt = right.nextRunAt?.getTime() ?? Number.POSITIVE_INFINITY;
  if (leftAt !== rightAt) return leftAt < rightAt ? -1 : 1;
  return left.triggerId.localeCompare(right.triggerId);
}

function toOpsScheduledJob({
  row,
  projectName,
}: {
  row: OperatorReportSchedule;
  projectName: string | null;
}): OpsScheduledJob {
  return {
    id: row.triggerId,
    projectName,
    projectId: row.projectId,
    targetType: REPORT_TARGET_TYPE,
    targetId: row.triggerId,
    cron: row.cron,
    timezone: row.timezone,
    nextRunAt: row.nextRunAt ? row.nextRunAt.toISOString() : null,
    lastSlot: row.lastRunAt ? row.lastRunAt.toISOString() : null,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
    currentSlot: row.running ? row.running.slot.toISOString() : null,
    attempts: 0,
    lastError: null,
    // Main's row was last touched when its slot was claimed, which the page's staleness reads.
    updatedAt: (row.running?.since ?? row.updatedAt).toISOString(),
  };
}
