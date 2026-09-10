import { Deferred } from "@langwatch/eventing";
import {
  TraceProcessingInstaller,
  type TraceProcessingCommands,
} from "@langwatch/trace-server";
import {
  type AssignTopicCommandData,
  type RecordSpanCommandData,
  TraceTopicAssignment,
} from "@langwatch/trace-contract";
import type {
  WorkerFeatureCloser,
  WorkerFeatureInstaller,
} from "../worker-feature.installer.ts";
import type { WorkerEventingRuntime } from "../../platform/eventing/worker-eventing.runtime.ts";

class WorkerTraceTopicAssignments extends TraceTopicAssignment {
  private delegate: TraceTopicAssignment | undefined;

  connect(delegate: TraceTopicAssignment): void {
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
export class TraceWorkerFeatureInstaller implements WorkerFeatureInstaller {
  static create(options: {
    installer: TraceProcessingInstaller;
    eventing: WorkerEventingRuntime;
  }): TraceWorkerFeatureInstaller {
    return new TraceWorkerFeatureInstaller(options.installer, options.eventing);
  }

  readonly name = "trace";
  readonly traceAssignments = new WorkerTraceTopicAssignments();

  private readonly recordSpan = new Deferred<(data: RecordSpanCommandData) => Promise<unknown>>(
    "trace.recordSpan",
  );
  readonly #changeTraceName = new Deferred<TraceProcessingCommands["changeTraceName"]>(
    "trace.changeTraceName",
  );
  readonly #addAnnotation = new Deferred<TraceProcessingCommands["addAnnotation"]>(
    "trace.addAnnotation",
  );
  readonly #removeAnnotation = new Deferred<TraceProcessingCommands["removeAnnotation"]>(
    "trace.removeAnnotation",
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
  readonly commands: TraceProcessingCommands = {
    recordSpan: this.recordSpan.fn,
    changeTraceName: this.#changeTraceName.fn,
    addAnnotation: this.#addAnnotation.fn,
    removeAnnotation: this.#removeAnnotation.fn,
  };

  private installed = false;

  private constructor(
    private readonly installer: TraceProcessingInstaller,
    private readonly eventing: WorkerEventingRuntime,
  ) {}

  async install(): Promise<WorkerFeatureCloser | undefined> {
    if (!this.installed) {
      const installed = this.installer.install(this.eventing.eventSourcing);
      this.traceAssignments.connect(installed.traceAssignments);
      this.recordSpan.resolve(installed.commands.recordSpan);
      this.#changeTraceName.resolve(installed.commands.changeTraceName);
      this.#addAnnotation.resolve(installed.commands.addAnnotation);
      this.#removeAnnotation.resolve(installed.commands.removeAnnotation);
      this.installed = true;
    }
    return undefined;
  }
}
