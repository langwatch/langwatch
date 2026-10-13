/**
 * The suite run's start command and the scenario owner's queued runs, held the
 * way the queues behind them hold them: a dispatch whose deduplication identity
 * has been seen is collapsed onto the first, so a merged retry is not read as two.
 */
import type { QueueSimulationRunInput } from "@langwatch/scenario-contract";
import type { StartSuiteRunCommandData } from "@langwatch/suite-contract";

import type { SuiteRunCommands } from "../../app/suite.app.ts";
import { StartSuiteRunCommand } from "../../eventing/suite-run.commands.ts";

export class CollapsingRunCommands implements SuiteRunCommands {
  /** The suite runs on record — one per distinct run, however often retried. */
  readonly started: StartSuiteRunCommandData[] = [];

  /** The simulation runs the scenario owner was asked to queue — one per distinct run id. */
  readonly queued: QueueSimulationRunInput[] = [];

  private readonly seen = new Set<string>();

  async startSuiteRun(data: StartSuiteRunCommandData): Promise<void> {
    const jobId = StartSuiteRunCommand.makeJobId?.(data);
    if (jobId !== undefined && !this.admit(jobId)) return;
    this.started.push(data);
  }

  /** What a `ScenarioApi.queueSimulationRun` double forwards to. */
  async queueSimulationRun(input: QueueSimulationRunInput): Promise<void> {
    if (!this.admit(`${input.projectId}:${input.scenarioRunId}:queue-run`)) return;
    this.queued.push(input);
  }

  /** True the first time an identity is dispatched, false for every repeat. */
  private admit(jobId: string): boolean {
    if (this.seen.has(jobId)) return false;
    this.seen.add(jobId);

    return true;
  }
}
