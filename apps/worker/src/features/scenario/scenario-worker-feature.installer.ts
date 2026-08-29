import { Deferred, type CommandDispatcher } from "@langwatch/eventing";
import { WorkerFeatureHandlePort, WorkerFeatureInstallerPort } from "../worker-feature.installer";
import type { WorkerEventingRuntime } from "../../platform/eventing/worker-eventing.runtime";

/** A registrable Eventing definition, as the worker's one runtime accepts it. */
type WorkerPipelineDefinition = Parameters<WorkerEventingRuntime["eventSourcing"]["register"]>[0];

/**
 * The scenario package's own description of its delayed metrics retry.
 *
 * Name, delay and deduplication are the feature's decisions and travel with
 * it; only the act of registering the job needs the live pipeline service,
 * which is why the installer performs it rather than the package.
 */
export interface ScenarioDeferredMetricsJobSpec<
  TPayload extends Record<string, unknown> = Record<string, unknown>,
> {
  readonly name: string;
  readonly delayMs: number;
  makeJobId(payload: TPayload): string;
  spanAttributes(payload: TPayload): Record<string, string | number | boolean>;
}

/** Scenario's worker-facing capability after its server graph is composed. */
export interface ScenarioWorkerCapability<
  TComputeRunMetrics extends Record<string, unknown> = Record<string, unknown>,
> {
  buildProcessing(): WorkerPipelineDefinition;
  readonly deferredComputeRunMetricsJob: ScenarioDeferredMetricsJobSpec<TComputeRunMetrics>;
  /**
   * Resolves the two dispatchers the definition was built against: the
   * self-referencing `computeRunMetrics` its own suite sync re-enters, and the
   * delayed retry the metrics command schedules when a trace is not summarised
   * yet. Both exist only after registration, which is why they are late-bound
   * rather than constructor arguments.
   */
  connect(bindings: {
    computeRunMetrics: CommandDispatcher<TComputeRunMetrics>;
    scheduleComputeRunMetricsRetry: (payload: TComputeRunMetrics) => Promise<void>;
  }): void;
}

/**
 * Worker registration for the Scenario (simulation run) pipeline.
 *
 * It installs after Suite, because the simulation process manager reports item
 * starts and completions into the suite run, and before nothing in
 * particular — Trace reaches it the other way round, through the
 * `computeRunMetrics` proxy this installer publishes.
 *
 * The delayed metrics retry is registered as a durable queue job, never as an
 * in-process timer. The legacy registry kept a `setTimeout` fallback for the
 * case where Eventing had no queue at all; a worker whose whole purpose is to
 * own the durable graph has no such case, and silently degrading to a timer
 * there would lose every scheduled retry on restart. A missing queue is
 * therefore a boot failure, stated rather than absorbed.
 */
export class ScenarioWorkerFeatureInstaller extends WorkerFeatureInstallerPort {
  static create(options: {
    installer: ScenarioWorkerCapability;
    eventing: WorkerEventingRuntime;
  }): ScenarioWorkerFeatureInstaller {
    return new ScenarioWorkerFeatureInstaller(options.installer, options.eventing);
  }

  readonly name = "scenario";

  private readonly computeRunMetrics = new Deferred<CommandDispatcher<Record<string, unknown>>>(
    "scenario.computeRunMetrics",
  );

  /**
   * Callable proxy for Trace's simulation-metrics sync subscriber, safe to
   * hand over before this installer runs.
   */
  readonly commands: { computeRunMetrics: CommandDispatcher<Record<string, unknown>> } = {
    computeRunMetrics: this.computeRunMetrics.fn,
  };

  private installed = false;

  private constructor(
    private readonly installer: ScenarioWorkerCapability,
    private readonly eventing: WorkerEventingRuntime,
  ) {
    super();
  }

  async install(): Promise<WorkerFeatureHandlePort> {
    if (!this.installed) {
      const pipeline = this.eventing.eventSourcing.register(this.installer.buildProcessing());
      const commands = pipeline.commands as Record<
        string,
        { send(data: Record<string, unknown>): Promise<void> }
      >;
      const computeRunMetrics = commands.computeRunMetrics;
      if (!computeRunMetrics) {
        throw new Error("Scenario pipeline must register a computeRunMetrics command.");
      }
      const dispatch: CommandDispatcher<Record<string, unknown>> = (data) =>
        computeRunMetrics.send(data);

      const job = this.installer.deferredComputeRunMetricsJob;
      const retryQueue = pipeline.service.registerJob<Record<string, unknown>>({
        name: job.name,
        process: (payload) => dispatch(payload),
        delay: job.delayMs,
        deduplication: {
          makeId: (payload) => job.makeJobId(payload),
          extend: false,
          replace: true,
        },
        spanAttributes: (payload) => job.spanAttributes(payload),
      });
      if (!retryQueue) {
        throw new Error(
          "Scenario deferred metrics retry requires a durable queue; the worker Eventing runtime registered none.",
        );
      }

      this.computeRunMetrics.resolve(dispatch);
      this.installer.connect({
        computeRunMetrics: dispatch,
        scheduleComputeRunMetricsRetry: (payload) => retryQueue.send(payload),
      });
      this.installed = true;
    }
    return ScenarioWorkerFeatureHandle.create();
  }
}

class ScenarioWorkerFeatureHandle extends WorkerFeatureHandlePort {
  static create(): ScenarioWorkerFeatureHandle {
    return new ScenarioWorkerFeatureHandle();
  }

  private constructor() {
    super();
  }

  async close(): Promise<void> {}
}
