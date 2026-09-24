import {
  ScenarioExecutionService,
  type ScenarioExecutionJob,
  type ScenarioExecutionPrefetchResult,
} from "@langwatch/scenario-contract";

import type { CancellationPublisher, ScenarioExecutionPool } from "../app/scenario.app.ts";

/**
 * How the run-execution process manager reaches a run: `submit` onto this
 * process's pool, `cancel` on the channel a running child listens on. Only
 * those two intents reach it; the rest refuse by name, as main's did.
 */
export class ScenarioRunDispatchService extends ScenarioExecutionService {
  private constructor(
    private readonly input: {
      pool: ScenarioExecutionPool | undefined;
      cancellations: CancellationPublisher;
    },
  ) {
    super();
  }

  static create(input: {
    pool: ScenarioExecutionPool | undefined;
    cancellations: CancellationPublisher;
  }): ScenarioRunDispatchService {
    return new ScenarioRunDispatchService(input);
  }

  async submit(input: ScenarioExecutionJob): Promise<void> {
    if (!this.input.pool) {
      throw new Error(
        `No execution pool in this process; the outbox will retry execute for scenarioRunId=${input.scenarioRunId}`,
      );
    }
    this.input.pool.submit(input);
  }

  async cancel(input: { projectId: string; scenarioRunId: string }): Promise<void> {
    await this.input.cancellations.publish(input);
  }

  prefetch(): Promise<ScenarioExecutionPrefetchResult> {
    return Promise.reject(new Error("Scenario prefetch is not reached through run dispatch."));
  }

  prepare(): never {
    throw new Error("Scenario preparation is not reached through run dispatch.");
  }

  finishUnsuccessfulRun(): Promise<never> {
    return Promise.reject(
      new Error("Scenario failure handling is not reached through run dispatch."),
    );
  }

  recordAgentInstance(): Promise<never> {
    return Promise.reject(
      new Error("Recording the serving agent instance is not reached through run dispatch."),
    );
  }
}
