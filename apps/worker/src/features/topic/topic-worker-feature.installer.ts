import { Deferred } from "@langwatch/eventing";
import type { TopicClusteringCommandsPort } from "@langwatch/topic-server";
import type { TraceTopicAssignmentPort } from "@langwatch/trace-contract";
import type { WorkerFeatureCloser, WorkerFeatureInstallerPort } from "../worker-feature.installer";
import type { WorkerEventingRuntime } from "../../platform/eventing/worker-eventing.runtime";

/** Topic's worker-facing capability after its server graph is composed. */
export interface TopicWorkerCapability {
  readonly commandDispatch: TopicClusteringCommandsPort;
  install(options: {
    eventSourcing: WorkerEventingRuntime["eventSourcing"];
    traceAssignments: TraceTopicAssignmentPort;
  }): { claimAndBootstrap: (projectId: string) => Promise<void> };
  startBootSeeds(): void;
}

/** Worker consumer, boot-seed, and manual-task wiring for the Topic installer. */
export class TopicWorkerFeatureInstaller implements WorkerFeatureInstallerPort {
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

  private readonly bootstrapTopicClustering = new Deferred<(projectId: string) => Promise<void>>(
    "topic.bootstrapTopicClustering",
  );

  /**
   * Callable proxy for Trace's `projectMetadata` subscriber.
   *
   * Late-bound because the two features mount in the opposite order to the one
   * this dependency runs in: Topic installs AFTER Trace, so the subscriber that
   * calls this is built before the function exists. Installation is fully
   * sequential and finishes before the consumer claims a job, so the proxy is
   * resolved by the time any project's first ingest reaches it.
   *
   * It is `claimAndBootstrap` and NOT `commandDispatch.requestClustering`. The
   * claim is what limits a project to one bootstrap an hour; dispatching the
   * command directly would run the ungated path, and the subscriber that calls
   * this fires on every first-ingest event a fresh project produces.
   */
  readonly commands: { bootstrapTopicClustering: (projectId: string) => Promise<void> } = {
    bootstrapTopicClustering: this.bootstrapTopicClustering.fn,
  };

  private installed = false;

  private constructor(
    private readonly installer: TopicWorkerCapability,
    private readonly eventing: WorkerEventingRuntime,
    private readonly traceAssignments: TraceTopicAssignmentPort,
  ) {}

  async install(): Promise<WorkerFeatureCloser | undefined> {
    if (!this.installed) {
      const installed = this.installer.install({
        eventSourcing: this.eventing.eventSourcing,
        traceAssignments: this.traceAssignments,
      });
      this.bootstrapTopicClustering.resolve(installed.claimAndBootstrap);
      this.installer.startBootSeeds();
      this.installed = true;
    }
    return undefined;
  }

  async requestManualRun(projectId: string, occurredAt = Date.now()): Promise<void> {
    await this.installer.commandDispatch.requestClustering({
      tenantId: projectId,
      occurredAt,
      trigger: "manual",
    });
  }
}
