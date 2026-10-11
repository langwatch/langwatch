import { setTimeout as wait } from "node:timers/promises";

import type { ProjectApi } from "@langwatch/project-contract";
import { nowInstant } from "@langwatch/time";
import { z } from "zod";

import type { TraceUsageCountRepository } from "../repositories/trace-usage-count.repository.ts";
import { countMomentAfter, monthStartOf, usageMonthOf } from "../rules/trace-first-seen.rules.ts";
import type { TraceCountMomentService } from "./trace-count-moment.service.ts";
import type { TraceProjectMilestonesService } from "./trace-project-milestones.service.ts";

const PROJECT_PAGE_SIZE = 500;
/** A summary written just before the moment is read only after its insert has landed. */
const SETTLE_MS = 60_000;
const POLL_MS = 15_000;

/** What the step saves after each page of projects and returns at the end. */
export const traceCountSeedReportSchema = z.object({
  countedUntil: z.number(),
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
  countMoment: Pick<TraceCountMomentService, "find" | "ensure">;
  milestones: Pick<TraceProjectMilestonesService, "recordMonthTracesCounted">;
  now?: () => number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  pageSize?: number;
}>;

/**
 * Counts each project's traces first seen this month up to a moment stored first, one event per
 * project. The new-trace subscriber sends only traces at or after that moment, so none is counted
 * twice. Spec: modules/trace/specs/trace-first-seen.feature.
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

  async recordMonthCounts({
    resumeFrom,
    dryRun,
    signal,
    onPage,
  }: TraceCountSeedInput): Promise<TraceCountSeedReport> {
    const countedUntil = await this.countedUntil({ resumeFrom, dryRun });
    let report: TraceCountSeedReport = resumeFrom ?? {
      countedUntil,
      month: usageMonthOf(countedUntil - 1),
      afterProjectId: null,
      projects: 0,
      traces: 0,
    };
    if (!dryRun && !resumeFrom) await onPage(report);
    if (!dryRun && !(await this.waitPast({ instant: countedUntil + SETTLE_MS, signal }))) {
      return report;
    }
    const window = {
      fromMs: monthStartOf(report.month),
      toMs: dryRun ? Math.min(countedUntil, this.now()) : countedUntil,
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

  /** The saved moment, else the stored one, else a new one stored now; a dry run stores none. */
  private async countedUntil({
    resumeFrom,
    dryRun,
  }: {
    resumeFrom: TraceCountSeedReport | null;
    dryRun: boolean;
  }): Promise<number> {
    if (resumeFrom) return resumeFrom.countedUntil;
    const proposed = countMomentAfter(this.now());
    if (dryRun) return (await this.deps.countMoment.find()) ?? proposed;
    return this.deps.countMoment.ensure({ countedUntil: proposed });
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
        await this.deps.milestones.recordMonthTracesCounted({
          tenantId: projectId,
          projectId,
          month: report.month,
          countedUntil: report.countedUntil,
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
