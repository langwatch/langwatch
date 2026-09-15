import { NlpFetchAdapter, type ScenarioProcessorService } from "@langwatch/scenario-server";
import type { WorkerFeatureCloser, WorkerFeatureInstaller } from "../worker-feature.installer.ts";

/**
 * Worker registration for the scenario EXECUTOR.
 */
export class ScenarioExecutionWorkerFeatureInstaller implements WorkerFeatureInstaller {
  static create(options: {
    processor: ScenarioProcessorService;
  }): ScenarioExecutionWorkerFeatureInstaller {
    return new ScenarioExecutionWorkerFeatureInstaller(options.processor);
  }

  readonly name = "scenario-execution";

  private constructor(private readonly processor: ScenarioProcessorService) {}

  async install(): Promise<WorkerFeatureCloser | undefined> {
    const running = await this.processor.start();
    return async () => {
      await running.close();
      await NlpFetchAdapter.create().close();
    };
  }
}
