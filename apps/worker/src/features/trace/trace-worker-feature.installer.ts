import { Deferred } from "@langwatch/eventing";
import {
  type TraceProcessingInstaller,
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
   * The `recordSpan` command as callable proxy for self-dispatch.
   * Allows the tracked-event reactor to send synthetic spans.
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
      this.recordSpan.resolve((data) => installed.commands.recordSpan(data));
      this.#changeTraceName.resolve((data) => installed.commands.changeTraceName(data));
      this.#addAnnotation.resolve((data) => installed.commands.addAnnotation(data));
      this.#removeAnnotation.resolve((data) => installed.commands.removeAnnotation(data));
      this.installed = true;
    }
    return undefined;
  }
}
