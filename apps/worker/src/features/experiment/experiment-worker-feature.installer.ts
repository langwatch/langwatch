import { Deferred, type CommandDispatcher } from "@langwatch/eventing";
import type { ExperimentRunProcessingPipeline } from "@langwatch/experiment-server";
import type {
  WorkerFeatureCloser,
  WorkerFeatureInstallerPort,
} from "../worker-feature.installer";
import type { WorkerEventingRuntime } from "../../platform/eventing/worker-eventing.runtime";

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
 * Worker registration for the Experiment run pipeline.
 *
 * Trace's experiment-metrics sync dispatches `computeExperimentRunMetrics`,
 * and in the legacy registry that subscriber was wired AFTER this pipeline
 * registered, through a mutable late-bound reference. The proxy this installer
 * publishes replaces that reference: the subscriber can be built first and
 * still cannot dispatch into an unregistered pipeline, because the proxy
 * throws until registration resolves it.
 *
 * The run-id to experiment-id lookup that subscriber also needs is a
 * repository read rather than a command, so it stays with the composition root
 * that owns the ClickHouse resolver; it is deliberately not part of this
 * feature's worker surface.
 */
export class ExperimentWorkerFeatureInstaller implements WorkerFeatureInstallerPort {
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
