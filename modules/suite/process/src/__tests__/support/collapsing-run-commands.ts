/**
 * The two Eventing commands a suite run dispatches, held the way the queue
 * behind them holds them: a command whose deduplication identity has been seen
 * is collapsed onto the first, so a retry the queue merged is not read as two.
 */
import type { StartSuiteRunCommandData } from "@langwatch/suite-contract";

import type { QueueSimulationRunCommandData, SuiteRunCommands } from "../../app/suite.app.ts";
import { StartSuiteRunCommand } from "../../eventing/suite-run.commands.ts";

export class CollapsingRunCommands implements SuiteRunCommands {
  /** The suite runs on record — one per distinct run, however often retried. */
  readonly started: StartSuiteRunCommandData[] = [];

  /** The simulation runs queued — one per distinct run id. */
  readonly queued: QueueSimulationRunCommandData[] = [];

  private readonly seen = new Set<string>();

  async startSuiteRun(data: StartSuiteRunCommandData): Promise<void> {
    const jobId = StartSuiteRunCommand.makeJobId?.(data);
    if (jobId !== undefined && !this.admit(jobId)) return;
    this.started.push(data);
  }

  async queueSimulationRun(data: QueueSimulationRunCommandData): Promise<void> {
    if (!this.admit(`${data.tenantId}:${data.scenarioRunId}:queue-run`)) return;
    this.queued.push(data);
  }

  /** True the first time an identity is dispatched, false for every repeat. */
  private admit(jobId: string): boolean {
    if (this.seen.has(jobId)) return false;
    this.seen.add(jobId);

    return true;
  }
}
