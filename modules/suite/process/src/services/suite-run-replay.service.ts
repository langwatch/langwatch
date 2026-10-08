import type { ScenarioApi, SimulationRunData } from "@langwatch/scenario-contract";
import { TERMINAL_STATUSES } from "@langwatch/scenario-contract";
import type { SuiteRunStateData } from "@langwatch/suite-contract";

import type { SuiteRepository } from "../repositories/suite.repository.ts";
import type { SuiteRunItemCommandsService } from "./suite-run-item-commands.service.ts";

/** The read side of suite-run processing: replay never opens the fold store. */
type OpenRunReader = {
  findOpenRuns(input: { tenantId: string }): Promise<SuiteRunStateData[]>;
};

type SuiteRunItemSenders = Pick<
  SuiteRunItemCommandsService,
  "recordSuiteRunItemStarted" | "completeSuiteRunItem"
>;

/** Scenario statuses a run holds before its started fact. */
const NOT_STARTED_STATUSES: readonly string[] = ["QUEUED", "PENDING"];

/** What one pass did across the open suite runs; the ledger keeps it. */
type SuiteRunReplayReport = {
  openRuns: number;
  behindRuns: number;
  startsSent: number;
  finishesSent: number;
  gradeDriftRuns: number;
};

/**
 * Re-feeds scenario's run facts into suite runs still open across the scenario -> suite cut.
 * Level-triggered: a run is touched only while its counts are behind scenario's runs, and each
 * send collapses on its item key (modules/suite/specs/suite-run-replay.feature).
 */
export class SuiteRunReplayService {
  static create(deps: {
    suites: Pick<SuiteRepository, "findProjectIdsHoldingSuites">;
    runs: OpenRunReader;
    scenarios: Pick<ScenarioApi, "getRunDataForBatchRun">;
    runItems: SuiteRunItemSenders;
  }): SuiteRunReplayService {
    return new SuiteRunReplayService(deps);
  }

  private constructor(private readonly deps: Parameters<typeof SuiteRunReplayService.create>[0]) {}

  async replayOpenRuns({
    dryRun,
    signal,
    afterTenantId,
    onTenantDone,
  }: {
    dryRun: boolean;
    signal: AbortSignal;
    afterTenantId: string | null;
    onTenantDone: (input: { tenantId: string; report: SuiteRunReplayReport }) => Promise<void>;
  }): Promise<SuiteRunReplayReport> {
    const report = emptyReport();
    const tenantIds = await this.deps.suites.findProjectIdsHoldingSuites();
    for (const tenantId of tenantIds) {
      if (signal.aborted) break;
      if (afterTenantId !== null && tenantId <= afterTenantId) continue;
      for (const run of await this.deps.runs.findOpenRuns({ tenantId })) {
        await this.replayRun({ tenantId, run, dryRun, report });
      }
      if (!dryRun) await onTenantDone({ tenantId, report });
    }
    return report;
  }

  private async replayRun({
    tenantId,
    run,
    dryRun,
    report,
  }: {
    tenantId: string;
    run: SuiteRunStateData;
    dryRun: boolean;
    report: SuiteRunReplayReport;
  }): Promise<void> {
    report.openRuns += 1;
    const data = await this.deps.scenarios.getRunDataForBatchRun({
      projectId: tenantId,
      scenarioSetId: run.ScenarioSetId,
      batchRunId: run.BatchRunId,
    });
    const plan = planReplay({ run, runs: data.changed ? data.runs : [] });
    if (plan.gradeDrift) report.gradeDriftRuns += 1;
    if (plan.starts.length + plan.finishes.length === 0) return;
    report.behindRuns += 1;
    report.startsSent += plan.starts.length;
    report.finishesSent += plan.finishes.length;
    if (dryRun) return;
    for (const item of plan.starts) await this.sendStarted({ tenantId, item });
    for (const item of plan.finishes) await this.sendFinished({ tenantId, item });
  }

  private sendStarted({ tenantId, item }: { tenantId: string; item: SimulationRunData }) {
    return this.deps.runItems.recordSuiteRunItemStarted({
      tenantId,
      batchRunId: item.batchRunId,
      scenarioRunId: item.scenarioRunId,
      scenarioId: item.scenarioId,
      occurredAt: item.timestamp,
    });
  }

  private sendFinished({ tenantId, item }: { tenantId: string; item: SimulationRunData }) {
    return this.deps.runItems.completeSuiteRunItem({
      tenantId,
      batchRunId: item.batchRunId,
      scenarioRunId: item.scenarioRunId,
      scenarioId: item.scenarioId,
      status: item.status,
      verdict: item.results?.verdict,
      durationMs: item.durationInMs,
      reasoning: item.results?.reasoning,
      error: item.results?.error,
      occurredAt: item.updatedAt ?? item.timestamp,
    });
  }
}

/** What an open run is behind on: every started or finished run, re-sent only while behind. */
function planReplay({ run, runs }: { run: SuiteRunStateData; runs: readonly SimulationRunData[] }) {
  const started = runs.filter((item) => !NOT_STARTED_STATUSES.includes(item.status));
  const finished = runs.filter((item) => isFinished(item));
  const startsBehind = run.StartedCount < started.length;
  const finishesBehind = run.CompletedCount + run.FailedCount < finished.length;
  return {
    starts: startsBehind ? started : [],
    finishes: finishesBehind ? finished : [],
    gradeDrift: !startsBehind && !finishesBehind && gradesDiffer({ run, finished }),
  };
}

function emptyReport(): SuiteRunReplayReport {
  return { openRuns: 0, behindRuns: 0, startsSent: 0, finishesSent: 0, gradeDriftRuns: 0 };
}

function isFinished(item: SimulationRunData): boolean {
  return (TERMINAL_STATUSES as ReadonlySet<string>).has(item.status);
}

/** Whether suite counted a grade scenario no longer holds: a regrade lost in the cut. */
function gradesDiffer({
  run,
  finished,
}: {
  run: SuiteRunStateData;
  finished: readonly SimulationRunData[];
}): boolean {
  const graded = finished.filter((item) => item.results?.verdict !== undefined);
  const passed = graded.filter((item) => item.results?.verdict === "success");
  return run.GradedCount !== graded.length || run.PassedCount !== passed.length;
}
