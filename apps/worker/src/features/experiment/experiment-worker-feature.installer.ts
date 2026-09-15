import { Deferred, type CommandDispatcher } from "@langwatch/eventing";
import type { ExperimentRunProcessingPipeline } from "@langwatch/experiment-server";
import type { WorkerFeatureCloser, WorkerFeatureInstaller } from "../worker-feature.installer.ts";
import type { WorkerEventingRuntime } from "../../platform/eventing/worker-eventing.runtime.ts";

/** Experiment's worker-facing capability after its server graph is composed. */
export interface ExperimentWorkerCapability {
  /**
   * Builds the experiment-run processing definition. Its ClickHouse state fold
   * and run-item map store are already bound by the composition root, which
   * also owns the Redis fold cache in front of the state store.
   */
  buildProcessing(): ExperimentRunProcessingPipeline;
}

/**
 * Worker registration for the Experiment run pipeline. The proxy allows
 * subscribers to dispatch computeExperimentRunMetrics after registration.
 */
export class ExperimentWorkerFeatureInstaller implements WorkerFeatureInstaller {
  static create(options: {
    installer: ExperimentWorkerCapability;
    eventing: WorkerEventingRuntime;
  }): ExperimentWorkerFeatureInstaller {
    return new ExperimentWorkerFeatureInstaller(options.installer, options.eventing);
  }

  readonly name = "experiment";

  private readonly computeExperimentRunMetrics = new Deferred<CommandDispatcher<unknown>>(
    "experiment.computeExperimentRunMetrics",
  );

  /** Callable proxy for Trace's experiment-metrics sync subscriber. */
  readonly commands: { computeExperimentRunMetrics: CommandDispatcher<unknown> } = {
    computeExperimentRunMetrics: this.computeExperimentRunMetrics.fn,
  };

  private installed = false;

  private constructor(
    private readonly installer: ExperimentWorkerCapability,
    private readonly eventing: WorkerEventingRuntime,
  ) {}

  async install(): Promise<WorkerFeatureCloser | undefined> {
    if (!this.installed) {
      const pipeline = this.eventing.eventSourcing.register(this.installer.buildProcessing());
      const commands = pipeline.commands as Record<string, { send(data: unknown): Promise<void> }>;
      const computeMetrics = commands.computeExperimentRunMetrics;
      if (!computeMetrics) {
        throw new Error(
          "Experiment run pipeline must register a computeExperimentRunMetrics command.",
        );
      }
      this.computeExperimentRunMetrics.resolve((data) => computeMetrics.send(data));
      this.installed = true;
    }
    return undefined;
  }
}
