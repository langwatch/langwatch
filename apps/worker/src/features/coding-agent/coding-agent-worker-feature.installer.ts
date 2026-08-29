import { Deferred, type CommandDispatcher } from "@langwatch/eventing";
import { WorkerFeatureHandlePort, WorkerFeatureInstallerPort } from "../worker-feature.installer";
import type { WorkerEventingRuntime } from "../../platform/eventing/worker-eventing.runtime";

/** A registrable Eventing definition, as the worker's one runtime accepts it. */
type WorkerPipelineDefinition = Parameters<WorkerEventingRuntime["eventSourcing"]["register"]>[0];

/**
 * The three contribution senders the source pipelines dispatch into (ADR-056).
 *
 * Coding Agent is a session aggregate assembled from facts that arrive on
 * other pipelines: spans on Trace, metrics on Metric, logs on Log. Each of
 * those mounts a dispatch subscriber that closes over one of these.
 */
export interface CodingAgentWorkerCommands<
  TSpanFacts = unknown,
  TMetricFacts = unknown,
  TLogFacts = unknown,
> {
  contributeSpanFacts: CommandDispatcher<TSpanFacts>;
  contributeMetricFacts: CommandDispatcher<TMetricFacts>;
  contributeLogFacts: CommandDispatcher<TLogFacts>;
}

/** Coding Agent's worker-facing capability after its server graph is composed. */
export interface CodingAgentWorkerCapability {
  buildProcessing(): WorkerPipelineDefinition;
}

/**
 * Worker registration for the Coding Agent session pipeline (ADR-056).
 *
 * It installs BEFORE Metric, Log and Trace. That is not a preference: the
 * dispatch subscribers those three mount close over this pipeline's
 * contribution commands, so a graph that registered them first would build
 * subscribers around commands that did not exist. The proxies published here
 * make that ordering checkable — a subscriber built too early still cannot
 * dispatch, and says so.
 */
export class CodingAgentWorkerFeatureInstaller extends WorkerFeatureInstallerPort {
  static create(options: {
    installer: CodingAgentWorkerCapability;
    eventing: WorkerEventingRuntime;
  }): CodingAgentWorkerFeatureInstaller {
    return new CodingAgentWorkerFeatureInstaller(options.installer, options.eventing);
  }

  readonly name = "coding-agent";

  private readonly spanFacts = new Deferred<CommandDispatcher<unknown>>(
    "codingAgent.contributeSpanFacts",
  );
  private readonly metricFacts = new Deferred<CommandDispatcher<unknown>>(
    "codingAgent.contributeMetricFacts",
  );
  private readonly logFacts = new Deferred<CommandDispatcher<unknown>>(
    "codingAgent.contributeLogFacts",
  );

  /** Callable proxies for the Trace, Metric and Log dispatch subscribers. */
  readonly commands: CodingAgentWorkerCommands = {
    contributeSpanFacts: this.spanFacts.fn,
    contributeMetricFacts: this.metricFacts.fn,
    contributeLogFacts: this.logFacts.fn,
  };

  private installed = false;

  private constructor(
    private readonly installer: CodingAgentWorkerCapability,
    private readonly eventing: WorkerEventingRuntime,
  ) {
    super();
  }

  async install(): Promise<WorkerFeatureHandlePort> {
    if (!this.installed) {
      const pipeline = this.eventing.eventSourcing.register(this.installer.buildProcessing());
      const commands = pipeline.commands as Record<string, { send(data: unknown): Promise<void> }>;
      const spanFacts = commands.contributeSpanFacts;
      const metricFacts = commands.contributeMetricFacts;
      const logFacts = commands.contributeLogFacts;
      if (!spanFacts || !metricFacts || !logFacts) {
        throw new Error(
          "Coding Agent pipeline must register contributeSpanFacts, contributeMetricFacts and contributeLogFacts commands.",
        );
      }
      this.spanFacts.resolve((data) => spanFacts.send(data));
      this.metricFacts.resolve((data) => metricFacts.send(data));
      this.logFacts.resolve((data) => logFacts.send(data));
      this.installed = true;
    }
    return CodingAgentWorkerFeatureHandle.create();
  }
}

class CodingAgentWorkerFeatureHandle extends WorkerFeatureHandlePort {
  static create(): CodingAgentWorkerFeatureHandle {
    return new CodingAgentWorkerFeatureHandle();
  }

  private constructor() {
    super();
  }

  async close(): Promise<void> {}
}
