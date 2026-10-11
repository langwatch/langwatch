import { setTimeout as wait } from "node:timers/promises";

import type { ProjectApi } from "@langwatch/project-contract";
import { nowInstant } from "@langwatch/time";
import { z } from "zod";

import type { TraceUsageCountRepository } from "../repositories/trace-usage-count.repository.ts";
import { countCutAfter, monthStartOf, usageMonthOf } from "../rules/trace-first-seen.rules.ts";
import type { TraceProjectMilestonesService } from "./trace-project-milestones.service.ts";

const PROJECT_PAGE_SIZE = 500;
/** A summary written just before the cut is read only after its insert has landed. */
const SETTLE_MS = 2 * 60_000;
const POLL_MS = 30_000;

/** What the step saves after each page of projects and returns at the end. */
export const traceCountSeedReportSchema = z.object({
  cutAt: z.number(),
  month: z.string(),
  afterProjectId: z.string().nullable(),
  projects: z.number(),
  traces: z.number(),
});
export type TraceCountSeedReport = z.infer<typeof traceCountSeedReportSchema>;

/** Where a run resumes, whether it writes, when it stops, and how it saves each page. */
export interface TraceCountSeedInput {
  resumeFrom: TraceCountSeedReport | null;
  dryRun: boolean;
  signal: AbortSignal;
  onPage: (report: TraceCountSeedReport) => Promise<void>;
}

type TraceCountSeedDependencies = Readonly<{
  projects: Pick<ProjectApi, "listAllIds">;
  usageCount: Pick<TraceUsageCountRepository, "countTracesFirstSeen">;
  milestones: Pick<TraceProjectMilestonesService, "recordTracesCountedBeforeCut">;
  now?: () => number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  pageSize?: number;
}>;

/**
 * Records, once per project, its traces first seen this month before an hour-aligned cut, so
 * entitlement's count starts complete; from the cut on, each trace arrives as its own fact.
 * Design and the cut's arithmetic: modules/trace/specs/trace-first-seen.feature.
 */
export class TraceCountSeedService {
  private readonly now: () => number;
  private readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  private readonly pageSize: number;

  private constructor(private readonly deps: TraceCountSeedDependencies) {
    this.now = deps.now ?? (() => nowInstant().epochMilliseconds);
    this.sleep =
      deps.sleep ?? ((ms, signal) => wait(ms, undefined, { signal }).catch(() => undefined));
    this.pageSize = deps.pageSize ?? PROJECT_PAGE_SIZE;
  }

  static create(deps: TraceCountSeedDependencies): TraceCountSeedService {
    return new TraceCountSeedService(deps);
  }

  async recordCountsBeforeCut({
    resumeFrom,
    dryRun,
    signal,
    onPage,
  }: TraceCountSeedInput): Promise<TraceCountSeedReport> {
    const cutAt = resumeFrom?.cutAt ?? countCutAfter(this.now());
    let report: TraceCountSeedReport = resumeFrom ?? {
      cutAt,
      month: usageMonthOf(cutAt - 1),
      afterProjectId: null,
      projects: 0,
      traces: 0,
    };
    // The cut is saved before any wait, so a resumed run counts against the same instant.
    if (!dryRun && !resumeFrom) await onPage(report);
    if (!dryRun && !(await this.waitPast({ instant: cutAt + SETTLE_MS, signal }))) return report;
    const window = {
      fromMs: monthStartOf(report.month),
      toMs: dryRun ? Math.min(cutAt, this.now()) : cutAt,
    };
    let after = report.afterProjectId ?? undefined;
    do {
      const page = await this.deps.projects.listAllIds({ after, limit: this.pageSize });
      report = await this.recordPage({ projectIds: page.ids, report, window, dryRun, signal });
      if (signal.aborted) return report;
      after = page.next ?? undefined;
      if (!dryRun) await onPage(report);
    } while (after !== undefined);
    return report;
  }

  /** Counts and records one page of projects; the report names the page's last project. */
  private async recordPage({
    projectIds,
    report,
    window,
    dryRun,
    signal,
  }: {
    projectIds: readonly string[];
    report: TraceCountSeedReport;
    window: { fromMs: number; toMs: number };
    dryRun: boolean;
    signal: AbortSignal;
  }): Promise<TraceCountSeedReport> {
    let next = report;
    for (const projectId of projectIds) {
      if (signal.aborted) return next;
      const traces = await this.deps.usageCount.countTracesFirstSeen({
        tenantId: projectId,
        ...window,
      });
      if (traces === 0) continue;
      if (!dryRun) {
        await this.deps.milestones.recordTracesCountedBeforeCut({
          tenantId: projectId,
          projectId,
          month: report.month,
          cutAt: report.cutAt,
          traces,
        });
      }
      next = { ...next, projects: next.projects + 1, traces: next.traces + traces };
    }
    return { ...next, afterProjectId: projectIds.at(-1) ?? next.afterProjectId };
  }

  /** Waits until the clock passes `instant`; false when aborted first. */
  private async waitPast({
    instant,
    signal,
  }: {
    instant: number;
    signal: AbortSignal;
  }): Promise<boolean> {
    while (this.now() < instant) {
      if (signal.aborted) return false;
      await this.sleep(Math.min(POLL_MS, instant - this.now()), signal);
    }
    return !signal.aborted;
  }
}
