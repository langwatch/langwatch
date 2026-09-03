import { Deferred } from "@langwatch/eventing";
import { TraceProcessingInstallerPort } from "@langwatch/trace-server";
import {
  type AssignTopicCommandData,
  type RecordSpanCommandData,
  TraceTopicAssignmentPort,
} from "@langwatch/trace-contract";
import type { WorkerFeatureCloser, WorkerFeatureInstallerPort } from "../worker-feature.installer";
import type { WorkerEventingRuntime } from "../../platform/eventing/worker-eventing.runtime";

class WorkerTraceTopicAssignments extends TraceTopicAssignmentPort {
  private delegate: TraceTopicAssignmentPort | undefined;

  connect(delegate: TraceTopicAssignmentPort): void {
    this.delegate = delegate;
  }

  assignTopic(input: AssignTopicCommandData): Promise<void> {
    if (!this.delegate) {
      throw new Error("Trace processing must install before Topic dispatches assignments.");
    }
    return this.delegate.assignTopic(input);
  }
}

/** Worker-owned mounting point for Trace's complete processing registration. */
export class TraceWorkerFeatureInstaller implements WorkerFeatureInstallerPort {
  static create(options: {
    installer: TraceProcessingInstallerPort;
    eventing: WorkerEventingRuntime;
  }): TraceWorkerFeatureInstaller {
    return new TraceWorkerFeatureInstaller(options.installer, options.eventing);
  }

  readonly name = "trace";
  readonly traceAssignments = new WorkerTraceTopicAssignments();

  private readonly recordSpan = new Deferred<(data: RecordSpanCommandData) => Promise<unknown>>(
    "trace.recordSpan",
  );

  /**
   * The registered `recordSpan` command, as a callable proxy.
   *
   * Trace is the one feature that dispatches into ITSELF: the tracked-event
   * reactor mints a synthetic span and has to send it the way an SDK export
   * would, which means the command only exists after the definition that
   * contains the reactor has been registered. The proxy closes that circle in
   * one place rather than making every caller carry a late-bound reference.
   */
  readonly commands: { recordSpan: (data: RecordSpanCommandData) => Promise<unknown> } = {
    recordSpan: this.recordSpan.fn,
  };

  private installed = false;

  private constructor(
    private readonly installer: TraceProcessingInstallerPort,
    private readonly eventing: WorkerEventingRuntime,
  ) {}

  async install(): Promise<WorkerFeatureCloser | undefined> {
    if (!this.installed) {
      const installed = this.installer.install(this.eventing.eventSourcing);
      this.traceAssignments.connect(installed.traceAssignments);
      this.recordSpan.resolve(installed.commands.recordSpan);
      this.installed = true;
    }
    return undefined;
  }
}
