import { Deferred, type CommandDispatcher } from "@langwatch/eventing";
import { WorkerFeatureHandlePort, WorkerFeatureInstallerPort } from "../worker-feature.installer";
import type { WorkerEventingRuntime } from "../../platform/eventing/worker-eventing.runtime";

/** A registrable Eventing definition, as the worker's one runtime accepts it. */
type WorkerPipelineDefinition = Parameters<
  WorkerEventingRuntime["eventSourcing"]["register"]
>[0];

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
export interface EvaluationWorkerCapability {
  /**
   * Builds the processing definition. The execution-intent service, the
   * analytics stores and the automation subscriber runtime are already bound
   * by the composition root; this seam only decides when registration happens.
   */
  buildProcessing(): WorkerPipelineDefinition;
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
export class EvaluationWorkerFeatureInstaller extends WorkerFeatureInstallerPort {
  static create(options: {
    installer: EvaluationWorkerCapability;
    eventing: WorkerEventingRuntime;
  }): EvaluationWorkerFeatureInstaller {
    return new EvaluationWorkerFeatureInstaller(options.installer, options.eventing);
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

  private constructor(
    private readonly installer: EvaluationWorkerCapability,
    private readonly eventing: WorkerEventingRuntime,
  ) {
    super();
  }

  async install(): Promise<WorkerFeatureHandlePort> {
    if (!this.installed) {
      const pipeline = this.eventing.eventSourcing.register(this.installer.buildProcessing());
      const commands = pipeline.commands as Record<string, { send(data: unknown): Promise<void> }>;
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
    return EvaluationWorkerFeatureHandle.create();
  }
}

class EvaluationWorkerFeatureHandle extends WorkerFeatureHandlePort {
  static create(): EvaluationWorkerFeatureHandle {
    return new EvaluationWorkerFeatureHandle();
  }

  private constructor() {
    super();
  }

  async close(): Promise<void> {}
}
