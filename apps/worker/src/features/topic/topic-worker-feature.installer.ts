import type { TopicClusteringCommandsPort } from "@langwatch/topic-server";
import type { TraceTopicAssignmentPort } from "@langwatch/trace-contract";
import { WorkerFeatureHandlePort, WorkerFeatureInstallerPort } from "../worker-feature.installer";
import type { WorkerEventingRuntime } from "../../platform/eventing/worker-eventing.runtime";

/** Topic's worker-facing capability after its server graph is composed. */
export interface TopicWorkerCapability {
  readonly commandDispatch: TopicClusteringCommandsPort;
  install(options: {
    eventSourcing: WorkerEventingRuntime["eventSourcing"];
    traceAssignments: TraceTopicAssignmentPort;
  }): unknown;
  startBootSeeds(): void;
}

/** Worker consumer, boot-seed, and manual-task wiring for the Topic installer. */
export class TopicWorkerFeatureInstaller extends WorkerFeatureInstallerPort {
  static create(options: {
    installer: TopicWorkerCapability;
    eventing: WorkerEventingRuntime;
    traceAssignments: TraceTopicAssignmentPort;
  }): TopicWorkerFeatureInstaller {
    return new TopicWorkerFeatureInstaller(
      options.installer,
      options.eventing,
      options.traceAssignments,
    );
  }

  readonly name = "topic";
  private installed = false;

  private constructor(
    private readonly installer: TopicWorkerCapability,
    private readonly eventing: WorkerEventingRuntime,
    private readonly traceAssignments: TraceTopicAssignmentPort,
  ) {
    super();
  }

  async install(): Promise<WorkerFeatureHandlePort> {
    if (!this.installed) {
      this.installer.install({
        eventSourcing: this.eventing.eventSourcing,
        traceAssignments: this.traceAssignments,
      });
      this.installer.startBootSeeds();
      this.installed = true;
    }
    return TopicWorkerFeatureHandle.create();
  }

  async requestManualRun(projectId: string, occurredAt = Date.now()): Promise<void> {
    await this.installer.commandDispatch.requestClustering({
      tenantId: projectId,
      occurredAt,
      trigger: "manual",
    });
  }
}

class TopicWorkerFeatureHandle extends WorkerFeatureHandlePort {
  static create(): TopicWorkerFeatureHandle {
    return new TopicWorkerFeatureHandle();
  }

  private constructor() {
    super();
  }

  async close(): Promise<void> {}
}
