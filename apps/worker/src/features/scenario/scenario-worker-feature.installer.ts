import {
  Deferred,
  type CommandDispatcher,
  type Event,
  type Projection,
  type RegisteredCommand,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";
import { scenarioDeferredComputeRunMetricsJob } from "@langwatch/scenario-server";
import type { WorkerFeatureCloser, WorkerFeatureInstaller } from "../worker-feature.installer.ts";
import type { WorkerEventingRuntime } from "../../platform/eventing/worker-eventing.runtime.ts";

/**
 * A registrable Eventing definition, left open in its own event union.
 * `prepareEventForProjection` is contravariant in the event type, so pinning
 * to the base `Event` would refuse a feature's own discriminated union.
 */
type WorkerPipelineDefinition<TEvent extends Event> = StaticPipelineDefinition<
  TEvent,
  Record<string, Projection>,
  RegisteredCommand
>;

/**
 * The scenario package's own description of its delayed metrics retry. Name,
 * delay and deduplication are the feature's decisions; only registering the
 * job needs the live pipeline service, so the installer does that part.
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
  TEvent extends Event = Event,
> {
  buildProcessing(): WorkerPipelineDefinition<TEvent>;
  /**
   * Resolves the two dispatchers the definition was built against: the
   * self-referencing `computeRunMetrics` and the delayed retry scheduled when
   * a trace isn't summarised yet. Both exist only after registration.
   */
  connect(bindings: {
    computeRunMetrics: CommandDispatcher<TComputeRunMetrics>;
    scheduleComputeRunMetricsRetry: (payload: TComputeRunMetrics) => Promise<void>;
    /**
     * Every command this registration produced, by name. The run-execution
     * process manager's `finish` intent appends `finishRun` back into the
     * pipeline, so the whole map is handed over rather than named per command.
     */
    commands: Record<string, CommandDispatcher<unknown>>;
  }): void;
}

/**
 * Worker registration for the Scenario (simulation run) pipeline.
 * Installs after Suite; metrics retry is durable queue job, not timer.
 */
export class ScenarioWorkerFeatureInstaller implements WorkerFeatureInstaller {
  static create<TComputeRunMetrics extends Record<string, unknown>, TEvent extends Event>(options: {
    installer: ScenarioWorkerCapability<TComputeRunMetrics, TEvent>;
    eventing: WorkerEventingRuntime;
  }): ScenarioWorkerFeatureInstaller {
    return new ScenarioWorkerFeatureInstaller(
      options.installer as unknown as ScenarioWorkerCapability,
      options.eventing,
    );
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
  ) {}

  async install(): Promise<WorkerFeatureCloser | undefined> {
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

      // Annotated rather than inferred: this is where the package's object is
      // held to the shape the registration below reads, so a drift in it fails
      // the worker's own build rather than at the first scheduled retry.
      const job: ScenarioDeferredMetricsJobSpec = scenarioDeferredComputeRunMetricsJob;
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
        commands: Object.fromEntries(
          Object.entries(commands).map(([name, command]) => [
            name,
            (data: unknown) => command.send(data as Record<string, unknown>),
          ]),
        ),
      });
      this.installed = true;
    }
    return undefined;
  }
}
