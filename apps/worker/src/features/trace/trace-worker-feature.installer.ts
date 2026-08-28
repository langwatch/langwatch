import { TraceProcessingInstallerPort } from "@langwatch/trace-server";
import { type AssignTopicCommandData, TraceTopicAssignmentPort } from "@langwatch/trace-contract";
import { WorkerFeatureHandlePort, WorkerFeatureInstallerPort } from "../worker-feature.installer";
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
export class TraceWorkerFeatureInstaller extends WorkerFeatureInstallerPort {
  static create(options: {
    installer: TraceProcessingInstallerPort;
    eventing: WorkerEventingRuntime;
  }): TraceWorkerFeatureInstaller {
    return new TraceWorkerFeatureInstaller(options.installer, options.eventing);
  }

  readonly name = "trace";
  readonly traceAssignments = new WorkerTraceTopicAssignments();
  private installed = false;

  private constructor(
    private readonly installer: TraceProcessingInstallerPort,
    private readonly eventing: WorkerEventingRuntime,
  ) {
    super();
  }

  async install(): Promise<WorkerFeatureHandlePort> {
    if (!this.installed) {
      const installed = this.installer.install(this.eventing.eventSourcing);
      this.traceAssignments.connect(installed.traceAssignments);
      this.installed = true;
    }
    return TraceWorkerFeatureHandle.create();
  }
}

class TraceWorkerFeatureHandle extends WorkerFeatureHandlePort {
  static create(): TraceWorkerFeatureHandle {
    return new TraceWorkerFeatureHandle();
  }

  private constructor() {
    super();
  }

  async close(): Promise<void> {}
}
