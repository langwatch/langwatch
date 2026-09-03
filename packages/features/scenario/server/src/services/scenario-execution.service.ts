import { ScenarioExecutionService as ScenarioExecutionServiceContract } from "@langwatch/scenario-contract";
import type {
  ScenarioExecutionJob,
  ScenarioExecutionPrefetchInput,
  ScenarioExecutionPrefetchResult,
  ScenarioExecutionPreparation,
  ScenarioUnsuccessfulExecutionInput,
} from "@langwatch/scenario-contract";

import type { CancellationPublisherPort } from "../ports/cancellation-channel.port";
import type { ScenarioExecutionPoolPort } from "../ports/scenario-execution-pool.port";
import type { ScenarioExecutionPrefetcherService } from "./scenario-execution-prefetcher.service";
import type { ScenarioFailureHandlerService } from "./scenario-failure-handler.service";

export class ScenarioExecutionService extends ScenarioExecutionServiceContract {
  static create(options: {
    pool: ScenarioExecutionPoolPort;
    cancellations: CancellationPublisherPort;
    prefetcher: ScenarioExecutionPrefetcherService;
    failures: ScenarioFailureHandlerService;
  }): ScenarioExecutionService {
    return new ScenarioExecutionService(options);
  }

  private constructor(
    private readonly options: {
      pool: ScenarioExecutionPoolPort;
      cancellations: CancellationPublisherPort;
      prefetcher: ScenarioExecutionPrefetcherService;
      failures: ScenarioFailureHandlerService;
    },
  ) {
    super();
  }

  async submit(input: ScenarioExecutionJob): Promise<void> {
    this.options.pool.submit(input);
  }

  async cancel(input: { projectId: string; scenarioRunId: string }): Promise<void> {
    await this.options.cancellations.publish(input);
  }

  prefetch(input: ScenarioExecutionPrefetchInput): Promise<ScenarioExecutionPrefetchResult> {
    return this.options.prefetcher.prefetch(input);
  }

  prepare(input: ScenarioExecutionPrefetchInput): ScenarioExecutionPreparation {
    return this.options.prefetcher.prepare(input);
  }

  finishUnsuccessfulRun(input: ScenarioUnsuccessfulExecutionInput): Promise<void> {
    return this.options.failures.finishUnsuccessfulRun(input);
  }
}
