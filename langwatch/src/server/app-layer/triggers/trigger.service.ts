import { TriggerKind } from "@prisma/client";
import type { Cluster, Redis } from "ioredis";
import { computeNextRunAt } from "~/server/app-layer/scheduler/nextRunAt";
import { SchedulerService } from "~/server/app-layer/scheduler/scheduler.service";
import type { ScheduledJobRepository } from "~/server/app-layer/scheduler/scheduler.types";
import { TtlCache } from "~/server/utils/ttlCache";
import {
  extractReportFromTriggerRow,
  REPORT_SCHEDULER_TARGET_TYPE,
} from "./report.builder";
import type {
  TriggerRepository,
  TriggerSummary,
} from "./repositories/trigger.repository";

export class TriggerService {
  private static readonly TTL_MS = 60_000;

  /**
   * ONE cache over the FULL active-triggers-per-project result. Trace vs
   * graph filters happen on read (both `getActive…` methods delegate to
   * this loader). The prior two-cache design (simp5013 double-cache
   * finding) issued 2× Redis GETs per project using both surfaces and
   * doubled the DB cost on cold start — the underlying `findActiveForProject`
   * is the same call either way, so warming one WAS warming the other.
   */
  private readonly cache = new TtlCache<TriggerSummary[]>(
    TriggerService.TTL_MS,
    "triggers:",
  );

  /**
   * `scheduledJobs` + `redis` are present only where reports are managed (they
   * back the report-schedule sync). Optional so the null/test wiring can omit
   * them; the sync methods no-op without a repository.
   */
  constructor(
    private readonly repo: TriggerRepository,
    private readonly scheduledJobs?: ScheduledJobRepository,
    private readonly redis?: Redis | Cluster | null,
  ) {}

  private async loadAll(projectId: string): Promise<TriggerSummary[]> {
    const cached = await this.cache.get(projectId);
    if (cached) return cached;
    const all = await this.repo.findActiveForProject(projectId);
    await this.cache.set(projectId, all);
    return all;
  }

  /**
   * Active TRACE automations for a project: the ones the trace/evaluation
   * pipelines fire per ingested trace.
   *
   * REPORTs are excluded (ADR-044). A report persists `filters: {}` and no
   * `customGraphId` — byte-identical to a match-everything trace automation —
   * so without the kind check every scheduled report would ALSO fire once per
   * ingested trace: the notify reactor enqueues a settle for any NOTIFY trigger
   * with no evaluation filters, and the settle dispatcher skips the filter
   * guard entirely when `filters` is empty. A report fires from its scheduler
   * calendar entry (`syncReportSchedule`) and nowhere else.
   */
  async getActiveTraceTriggersForProject(
    projectId: string,
  ): Promise<TriggerSummary[]> {
    const all = await this.loadAll(projectId);
    return all.filter(
      (t) => !t.customGraphId && t.triggerKind !== TriggerKind.REPORT,
    );
  }

  /**
   * Active custom-graph triggers for a project (ADR-034 Phase 5).
   * Counterpart to `getActiveTraceTriggersForProject`: filters the
   * SAME `findActiveForProject` read down to rows with `customGraphId`,
   * which is the cron's definition of a graph trigger.
   *
   * REPORTs are excluded here too: a report whose source is a custom graph is
   * still schedule-fired, and converting an existing graph alert into a report
   * leaves the old `customGraphId` on the row — which would otherwise re-arm it
   * as a threshold alert on the heartbeat path.
   */
  async getActiveGraphTriggersForProject(
    projectId: string,
  ): Promise<TriggerSummary[]> {
    const all = await this.loadAll(projectId);
    return all.filter(
      (t) => t.customGraphId != null && t.triggerKind !== TriggerKind.REPORT,
    );
  }

  /**
   * Atomically claim (triggerId, traceId). Returns true on first claim,
   * false if another reactor already claimed it. Side effects (email,
   * slack, dataset write) must run only when this returns true to avoid
   * double-fire on concurrent dispatch or reactor retry.
   */
  async claimSend(params: {
    triggerId: string;
    traceId: string;
    projectId: string;
  }): Promise<boolean> {
    return this.repo.claimSend(params);
  }

  /**
   * Read-only existence check for a (triggerId, traceId) claim. The
   * outbox cadence dispatcher uses this to skip pairs already dispatched
   * in a prior batch while keeping the actual `claimSend` write deferred
   * until after a successful provider call — see `dispatcher.ts`.
   */
  async isSendClaimed(params: {
    triggerId: string;
    traceId: string;
    projectId: string;
  }): Promise<boolean> {
    return this.repo.isSendClaimed(params);
  }

  async updateLastRunAt(triggerId: string, projectId: string): Promise<void> {
    return this.repo.updateLastRunAt(triggerId, projectId);
  }

  async invalidate(projectId: string): Promise<void> {
    await this.cache.delete(projectId);
  }

  /**
   * Sync a scheduled report's calendar entry (ADR-044): create/refresh the
   * `ScheduledJob` for this report trigger and best-effort wake every pod's
   * scheduler loop so it picks up the (possibly sooner) next run now. The
   * report trigger id IS the scheduler `targetId`. No-op if the scheduler
   * repository isn't wired (test/null environments).
   */
  async syncReportSchedule(params: {
    projectId: string;
    triggerId: string;
    cron: string;
    timezone: string;
  }): Promise<void> {
    if (!this.scheduledJobs) return;
    const nextRunAt = computeNextRunAt({
      cron: params.cron,
      timezone: params.timezone,
      after: new Date(),
    });
    await this.scheduledJobs.upsertForTarget({
      projectId: params.projectId,
      targetType: REPORT_SCHEDULER_TARGET_TYPE,
      targetId: params.triggerId,
      cron: params.cron,
      timezone: params.timezone,
      nextRunAt,
    });
    SchedulerService.publishWake(this.redis);
  }

  /**
   * Repair report schedules that never got written (ADR-044 durable self-heal).
   * The upsert route writes the REPORT `Trigger` row and its `ScheduledJob` in
   * two separate, non-atomic steps; a crash/timeout between them leaves an active
   * report with NO schedule, so it silently never runs. This pass — run at worker
   * boot — finds every active report lacking a `ScheduledJob` and creates it, so
   * an interrupted save is corrected without the user re-saving.
   *
   * Create-if-MISSING only: a report that already has a schedule row is left
   * untouched, including a PAUSED one (inactive row present) — reconciliation
   * must never resurrect a schedule the user paused, nor reset a live calendar.
   * Safe to run on every worker: the create is race-hardened on the
   * `(targetType, targetId)` unique (`upsertForTarget`). No-op without a
   * scheduler repository (null/test wiring). Returns the repair count.
   */
  async reconcileReportSchedules(): Promise<{ repaired: number }> {
    if (!this.scheduledJobs) return { repaired: 0 };
    const reports = await this.repo.findActiveReportTargets();
    if (reports.length === 0) return { repaired: 0 };

    // Target ids that already own a ScheduledJob (active OR paused), gathered
    // per distinct project so a paused report is recognised and skipped.
    const scheduledTargetIds = new Set<string>();
    for (const projectId of new Set(reports.map((r) => r.projectId))) {
      const jobs = await this.scheduledJobs.findAllForProject({
        projectId,
        targetType: REPORT_SCHEDULER_TARGET_TYPE,
      });
      for (const job of jobs) scheduledTargetIds.add(job.targetId);
    }

    let repaired = 0;
    for (const report of reports) {
      if (scheduledTargetIds.has(report.id)) continue;
      const parsed = extractReportFromTriggerRow(report.actionParams);
      // Unparseable actionParams (legacy/corrupt) have no schedule to build —
      // the report handler already skips such rows, so leave them unscheduled.
      if (!parsed) continue;
      await this.syncReportSchedule({
        projectId: report.projectId,
        triggerId: report.id,
        cron: parsed.schedule.cron,
        timezone: parsed.schedule.timezone,
      });
      repaired++;
    }
    return { repaired };
  }

  /** Deactivate a report's schedule so the scheduler due-scan skips it. */
  async removeReportSchedule(params: {
    projectId: string;
    triggerId: string;
  }): Promise<void> {
    if (!this.scheduledJobs) return;
    await this.scheduledJobs.deactivateForTarget({
      projectId: params.projectId,
      targetType: REPORT_SCHEDULER_TARGET_TYPE,
      targetId: params.triggerId,
    });
  }

  /**
   * When each of the project's reports next runs, and when it last ran —
   * keyed by report trigger id. The scheduler owns these instants (the cron on
   * the trigger is only a description of them), so a report's real next run can
   * only be answered from here. Empty where no scheduler is wired.
   */
  async getReportSchedules(params: {
    projectId: string;
  }): Promise<ReportSchedule[]> {
    if (!this.scheduledJobs) return [];
    const jobs = await this.scheduledJobs.findAllForProject({
      projectId: params.projectId,
      targetType: REPORT_SCHEDULER_TARGET_TYPE,
    });
    return jobs.map((job) => ({
      triggerId: job.targetId,
      // A deactivated schedule keeps its stale `nextRunAt` in the row; a paused
      // report must not claim a next run it will never take.
      nextRunAt: job.active ? job.nextRunAt : null,
      lastRunAt: job.lastSlot,
      active: job.active,
    }));
  }
}

/** When a report next runs and when it last ran, as the page shows it. */
export interface ReportSchedule {
  triggerId: string;
  /** Null when the report is paused — a paused schedule never comes due. */
  nextRunAt: Date | null;
  /** The last calendar slot fired; null until the report first runs. */
  lastRunAt: Date | null;
  active: boolean;
}
