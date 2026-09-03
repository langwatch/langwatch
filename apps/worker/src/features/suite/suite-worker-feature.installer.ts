import { Deferred, type CommandDispatcher } from "@langwatch/eventing";
import type { SuiteRunProcessingPipeline } from "@langwatch/suite-server";
import type {
  WorkerFeatureCloser,
  WorkerFeatureInstallerPort,
} from "../worker-feature.installer";
import type { WorkerEventingRuntime } from "../../platform/eventing/worker-eventing.runtime";

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
   * Builds the suite-run processing definition, deduplication included.
   *
   * The three commands register WITH deduplication options, and that is
   * load-bearing rather than incidental: `withCommand` reads deduplication
   * only from its options and never from a handler's static `makeJobId`, and
   * the run-state fold accumulates by addition. Registered without them, a
   * redelivered item event double-counts a suite run's progress and can flip
   * its status to SUCCESS or FAILURE before the run has finished.
   */
  buildProcessing(): SuiteRunProcessingPipeline;
}

/**
 * Worker registration for the Suite run pipeline.
 *
 * It installs before Scenario, whose simulation process manager reports item
 * starts and completions into this pipeline. Suite itself subscribes to
 * nothing — every cross-pipeline subscriber in this pair lives on the
 * simulation side — so this installer has no ordering requirement of its own
 * beyond preceding the pipeline that dispatches to it.
 */
export class SuiteWorkerFeatureInstaller implements WorkerFeatureInstallerPort {
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
