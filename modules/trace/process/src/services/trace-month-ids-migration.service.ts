import type { ProjectApi } from "@langwatch/project-contract";
import { nowInstant } from "@langwatch/time";
import { MONTH_TRACE_IDS_PAGE_SIZE } from "@langwatch/trace-contract";
import { z } from "zod";

import type { TraceUsageCountRepository } from "../repositories/trace-usage-count.repository.ts";
import { monthStartOf, usageMonthOf } from "../rules/trace-usage-month.rules.ts";
import type { TraceProjectMilestonesService } from "./trace-project-milestones.service.ts";

const PROJECT_PAGE_SIZE = 500;

/** What the step saves after each page of trace ids and returns at the end. */
export const traceMonthIdsReportSchema = z.object({
  month: z.string(),
  fromMs: z.number(),
  toMs: z.number(),
  /** The last project whose ids were all sent; the next run lists projects after it. */
  afterProjectId: z.string().nullable(),
  /** A project part-sent when the run stopped, and the last trace id it sent. */
  inProject: z.object({ projectId: z.string(), afterTraceId: z.string() }).nullable(),
  projects: z.number(),
  traceIds: z.number(),
  events: z.number(),
});
export type TraceMonthIdsReport = z.infer<typeof traceMonthIdsReportSchema>;

/** Where a run resumes, whether it writes, when it stops, and how it saves its progress. */
export interface TraceMonthIdsInput {
  resumeFrom: TraceMonthIdsReport | null;
  dryRun: boolean;
  signal: AbortSignal;
  onPage: (report: TraceMonthIdsReport) => Promise<void>;
}

type TraceMonthIdsDependencies = Readonly<{
  projects: Pick<ProjectApi, "listAllIds">;
  usageCount: Pick<TraceUsageCountRepository, "findTraceIdsFirstSeen">;
  milestones: Pick<TraceProjectMilestonesService, "recordMonthTraceIds">;
  now?: () => number;
  pageSize?: number;
  traceIdPageSize?: number;
}>;

/**
 * Sends each project's trace ids first seen this month up to the run's start, one event per page.
 * Live counting covers later traces; overlap is harmless because usage keys rows by trace.
 * Spec: modules/trace/specs/trace-month-trace-ids.feature.
 */
export class TraceMonthIdsMigrationService {
  private readonly now: () => number;
  private readonly pageSize: number;
  private readonly traceIdPageSize: number;

  private constructor(private readonly deps: TraceMonthIdsDependencies) {
    this.now = deps.now ?? (() => nowInstant().epochMilliseconds);
    this.pageSize = deps.pageSize ?? PROJECT_PAGE_SIZE;
    this.traceIdPageSize = deps.traceIdPageSize ?? MONTH_TRACE_IDS_PAGE_SIZE;
  }

  static create(deps: TraceMonthIdsDependencies): TraceMonthIdsMigrationService {
    return new TraceMonthIdsMigrationService(deps);
  }

  async sendMonthTraceIds({
    resumeFrom,
    dryRun,
    signal,
    onPage,
  }: TraceMonthIdsInput): Promise<TraceMonthIdsReport> {
    let report = resumeFrom ?? this.firstReport();
    let after = report.afterProjectId ?? undefined;
    do {
      const page = await this.deps.projects.listAllIds({ after, limit: this.pageSize });
      for (const projectId of page.ids) {
        report = await this.sendProject({ projectId, report, dryRun, signal, onPage });
        if (signal.aborted) return report;
        report = { ...report, afterProjectId: projectId, inProject: null };
        if (!dryRun) await onPage(report);
      }
      after = page.next ?? undefined;
    } while (after !== undefined);
    return report;
  }

  private firstReport(): TraceMonthIdsReport {
    const toMs = this.now();
    const month = usageMonthOf(toMs);
    return {
      month,
      fromMs: monthStartOf(month),
      toMs,
      afterProjectId: null,
      inProject: null,
      projects: 0,
      traceIds: 0,
      events: 0,
    };
  }

  /** Sends one project's ids page by page, saving after each page it sends. */
  private async sendProject({
    projectId,
    report,
    dryRun,
    signal,
    onPage,
  }: {
    projectId: string;
    report: TraceMonthIdsReport;
    dryRun: boolean;
    signal: AbortSignal;
    onPage: (report: TraceMonthIdsReport) => Promise<void>;
  }): Promise<TraceMonthIdsReport> {
    let next = report;
    let afterTraceId =
      report.inProject?.projectId === projectId ? report.inProject.afterTraceId : "";
    let sentAny = afterTraceId !== "";
    while (!signal.aborted) {
      const traceIds = await this.deps.usageCount.findTraceIdsFirstSeen({
        tenantId: projectId,
        fromMs: report.fromMs,
        toMs: report.toMs,
        afterTraceId,
        limit: this.traceIdPageSize,
      });
      const last = traceIds.at(-1);
      if (last === undefined) break;
      if (!dryRun) {
        await this.deps.milestones.recordMonthTraceIds({
          tenantId: projectId,
          projectId,
          month: report.month,
          traceIds,
        });
      }
      next = {
        ...next,
        projects: sentAny ? next.projects : next.projects + 1,
        traceIds: next.traceIds + traceIds.length,
        events: next.events + 1,
        inProject: { projectId, afterTraceId: last },
      };
      sentAny = true;
      afterTraceId = last;
      if (!dryRun) await onPage(next);
      if (traceIds.length < this.traceIdPageSize) break;
    }
    return next;
  }
}
