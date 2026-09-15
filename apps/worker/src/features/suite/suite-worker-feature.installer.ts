import { Deferred, type CommandDispatcher } from "@langwatch/eventing";
import type { SuiteRunProcessingPipeline } from "@langwatch/suite-server";
import type { WorkerFeatureCloser, WorkerFeatureInstaller } from "../worker-feature.installer.ts";
import type { WorkerEventingRuntime } from "../../platform/eventing/worker-eventing.runtime.ts";

/**
 * The two suite-run senders the Scenario pipeline's suite sync dispatches to.
 *
 * `startSuiteRun` is deliberately absent: it is dispatched by the API when a
 * suite begins, never by another worker pipeline, so exposing it here would
 * widen the cross-feature surface for nothing.
 */
export interface SuiteWorkerCommands<TRecordItemStarted = unknown, TCompleteItem = unknown> {
  recordSuiteRunItemStarted: CommandDispatcher<TRecordItemStarted>;
  completeSuiteRunItem: CommandDispatcher<TCompleteItem>;
}

/** Suite's worker-facing capability after its server graph is composed. */
export interface SuiteWorkerCapability {
  /**
   * Builds the suite-run processing definition with deduplication.
   * Required to prevent redelivered events from double-counting progress.
   */
  buildProcessing(): SuiteRunProcessingPipeline;
}

/**
 * Worker registration for the Suite run pipeline.
 * Installs before Scenario, which dispatches item starts and completions to it.
 */
export class SuiteWorkerFeatureInstaller implements WorkerFeatureInstaller {
  static create(options: {
    installer: SuiteWorkerCapability;
    eventing: WorkerEventingRuntime;
  }): SuiteWorkerFeatureInstaller {
    return new SuiteWorkerFeatureInstaller(options.installer, options.eventing);
  }

  readonly name = "suite";

  private readonly recordSuiteRunItemStarted = new Deferred<CommandDispatcher<unknown>>(
    "suite.recordSuiteRunItemStarted",
  );
  private readonly completeSuiteRunItem = new Deferred<CommandDispatcher<unknown>>(
    "suite.completeSuiteRunItem",
  );

  /** Callable proxies, safe to hand to the Scenario installer before install. */
  readonly commands: SuiteWorkerCommands = {
    recordSuiteRunItemStarted: this.recordSuiteRunItemStarted.fn,
    completeSuiteRunItem: this.completeSuiteRunItem.fn,
  };

  private installed = false;

  private constructor(
    private readonly installer: SuiteWorkerCapability,
    private readonly eventing: WorkerEventingRuntime,
  ) {}

  async install(): Promise<WorkerFeatureCloser | undefined> {
    if (!this.installed) {
      const pipeline = this.eventing.eventSourcing.register(this.installer.buildProcessing());
      const commands = pipeline.commands as Record<string, { send(data: unknown): Promise<void> }>;
      const recordStarted = commands.recordSuiteRunItemStarted;
      const completeItem = commands.completeSuiteRunItem;
      if (!recordStarted || !completeItem) {
        throw new Error(
          "Suite run pipeline must register recordSuiteRunItemStarted and completeSuiteRunItem commands.",
        );
      }
      this.recordSuiteRunItemStarted.resolve((data) => recordStarted.send(data));
      this.completeSuiteRunItem.resolve((data) => completeItem.send(data));
      this.installed = true;
    }
    return undefined;
  }
}
