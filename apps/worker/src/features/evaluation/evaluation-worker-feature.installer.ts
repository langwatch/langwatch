import {
  Deferred,
  type CommandDispatcher,
  type Event,
  type Projection,
  type RegisteredCommand,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";
import type { WorkerFeatureCloser, WorkerFeatureInstaller } from "../worker-feature.installer.ts";
import type { WorkerEventingRuntime } from "../../platform/eventing/worker-eventing.runtime.ts";

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
 * The two Evaluation command senders that other pipelines dispatch to. Named
 * (not opaque) because they are the whole cross-pipeline surface.
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
 * Worker registration for Evaluation's durable processing pipeline. Must install
 * before Trace, Metric and Log (they dispatch evaluation commands).
 */
export class EvaluationWorkerFeatureInstaller implements WorkerFeatureInstaller {
  static create<TEvent extends Event>(options: {
    installer: EvaluationWorkerCapability<TEvent>;
    eventing: WorkerEventingRuntime;
  }): EvaluationWorkerFeatureInstaller {
    return new EvaluationWorkerFeatureInstaller(
      () => options.eventing.eventSourcing.register(options.installer.buildProcessing()).commands,
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
