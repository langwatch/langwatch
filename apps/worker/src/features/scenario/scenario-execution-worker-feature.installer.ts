import {
  closeNlpFetchDispatchers,
  type ScenarioProcessorService,
} from "@langwatch/scenario-server";
import type { WorkerFeatureCloser, WorkerFeatureInstallerPort } from "../worker-feature.installer";

/**
 * Worker registration for the scenario EXECUTOR.
 *
 * Separate from `scenario`, which registers the simulation pipeline, because
 * the two answer different questions: every worker folds simulation events,
 * and only a worker that composed a pool, a child spawner and a run preparer
 * can turn a queued run into a running one. Splitting them is what lets the
 * second be absent without taking the first's sixteen routing keys with it.
 *
 * It installs AFTER `scenario`: `start()` connects the pool to its runner, and
 * a pool connected before the pipeline it finishes runs into is registered
 * would have a window where a run could start and its terminal event have
 * nowhere to land.
 *
 * The closer DRAINS rather than kills: every run still in flight is finished
 * with a terminal failure before the children are signalled, so a rolling
 * deploy leaves no run orphaned at queued. It also closes the memoized NLP
 * fetch dispatchers, whose pooled sockets to the engine are opened by the very
 * adapters a run's child and its workflow targets dial through — nothing else
 * in this process opens them, and nothing else would release them.
 */
export class ScenarioExecutionWorkerFeatureInstaller implements WorkerFeatureInstallerPort {
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
      await closeNlpFetchDispatchers();
    };
  }
}
