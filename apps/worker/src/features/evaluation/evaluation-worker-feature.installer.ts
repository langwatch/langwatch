import {
  Deferred,
  type CommandDispatcher,
  type Event,
  type Projection,
  type RegisteredCommand,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";
import type {
  WorkerFeatureCloser,
  WorkerFeatureInstallerPort,
} from "../worker-feature.installer";
import type { WorkerEventingRuntime } from "../../platform/eventing/worker-eventing.runtime";

/**
 * A registrable Eventing definition, left open in its own event union.
 *
 * `prepareEventForProjection` is contravariant in the event type, so a
 * definition pinned to the base `Event` refuses the very definition Evaluation
 * publishes over `EvaluationProcessingEvent`. The capability below carries the
 * union as a parameter and the installer never names it.
 */
type WorkerPipelineDefinition<TEvent extends Event> = StaticPipelineDefinition<
  TEvent,
  Record<string, Projection>,
  RegisteredCommand
>;

/**
 * The two Evaluation command senders other pipelines dispatch to.
 *
 * Trace's evaluation trigger and its custom-evaluation sync both close over
 * these, and both mount on a pipeline registered after this one. They are
 * named rather than passed as an opaque command map because these two are the
 * whole cross-pipeline surface — anything else Evaluation registers is its own
 * business.
 */
export interface EvaluationWorkerCommands<
  TExecuteEvaluation = unknown,
  TReportEvaluation = unknown,
> {
  executeEvaluation: CommandDispatcher<TExecuteEvaluation>;
  reportEvaluation: CommandDispatcher<TReportEvaluation>;
}

/** Evaluation's worker-facing capability after its server graph is composed. */
export interface EvaluationWorkerCapability<TEvent extends Event = Event> {
  /**
   * Builds the processing definition. The execution-intent service, the
   * analytics stores and the automation subscriber runtime are already bound
   * by the composition root; this seam only decides when registration happens.
   */
  buildProcessing(): WorkerPipelineDefinition<TEvent>;
}

/**
 * Worker registration for Evaluation's durable processing pipeline.
 *
 * It installs BEFORE Trace, Metric and Log, because the subscribers those
 * pipelines mount dispatch `executeEvaluation` and `reportEvaluation`. The
 * registration order is the composition root's to choose; what this installer
 * guarantees is that `commands` is unusable until the pipeline it names has
 * actually been registered, so a mis-ordered graph fails loudly at boot
 * instead of dispatching into a pipeline that does not exist yet.
 */
export class EvaluationWorkerFeatureInstaller implements WorkerFeatureInstallerPort {
  static create<TEvent extends Event>(options: {
    installer: EvaluationWorkerCapability<TEvent>;
    eventing: WorkerEventingRuntime;
  }): EvaluationWorkerFeatureInstaller {
    return new EvaluationWorkerFeatureInstaller(() =>
      options.eventing.eventSourcing.register(options.installer.buildProcessing()).commands,
    );
  }

  readonly name = "evaluation";

  private readonly executeEvaluation = new Deferred<CommandDispatcher<unknown>>(
    "evaluation.executeEvaluation",
  );
  private readonly reportEvaluation = new Deferred<CommandDispatcher<unknown>>(
    "evaluation.reportEvaluation",
  );

  /**
   * Callable proxies, safe to hand to a Trace or Metric subscriber before this
   * installer runs. They throw until registration resolves them.
   */
  readonly commands: EvaluationWorkerCommands = {
    executeEvaluation: this.executeEvaluation.fn,
    reportEvaluation: this.reportEvaluation.fn,
  };

  private installed = false;

  private constructor(private readonly registerPipeline: () => unknown) {}

  async install(): Promise<WorkerFeatureCloser | undefined> {
    if (!this.installed) {
      const commands = this.registerPipeline() as Record<
        string,
        { send(data: unknown): Promise<void> }
      >;
      const executeEvaluation = commands.executeEvaluation;
      const reportEvaluation = commands.reportEvaluation;
      if (!executeEvaluation || !reportEvaluation) {
        throw new Error(
          "Evaluation processing pipeline must register executeEvaluation and reportEvaluation commands.",
        );
      }
      this.executeEvaluation.resolve((data) => executeEvaluation.send(data));
      this.reportEvaluation.resolve((data) => reportEvaluation.send(data));
      this.installed = true;
    }
    return undefined;
  }
}
