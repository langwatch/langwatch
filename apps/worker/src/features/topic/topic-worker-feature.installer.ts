import { Deferred } from "@langwatch/eventing";
import type { TopicClusteringCommands } from "@langwatch/topic-server";
import type { TraceTopicAssignment } from "@langwatch/trace-contract";
import type {
  WorkerFeatureCloser,
  WorkerFeatureInstaller,
} from "../worker-feature.installer.ts";
import type { WorkerEventingRuntime } from "../../platform/eventing/worker-eventing.runtime.ts";
import { nowInstant } from "@langwatch/time";

/** Topic's worker-facing capability after its server graph is composed. */
export interface TopicWorkerCapability {
  readonly commandDispatch: TopicClusteringCommands;
  install(options: {
    eventSourcing: WorkerEventingRuntime["eventSourcing"];
    traceAssignments: TraceTopicAssignment;
  }): { claimAndBootstrap: (projectId: string) => Promise<void> };
  startBootSeeds(): void;
}

/** Worker consumer, boot-seed, and manual-task wiring for the Topic installer. */
export class TopicWorkerFeatureInstaller implements WorkerFeatureInstaller {
  static create(options: {
    installer: TopicWorkerCapability;
    eventing: WorkerEventingRuntime;
    traceAssignments: TraceTopicAssignment;
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
   * Callable proxy for Trace's `projectMetadata` subscriber, late-bound.
   * Uses `claimAndBootstrap` to rate-limit to one bootstrap per project per hour.
   */
  readonly commands: { bootstrapTopicClustering: (projectId: string) => Promise<void> } = {
    bootstrapTopicClustering: this.bootstrapTopicClustering.fn,
  };

  private installed = false;

  private constructor(
    private readonly installer: TopicWorkerCapability,
    private readonly eventing: WorkerEventingRuntime,
    private readonly traceAssignments: TraceTopicAssignment,
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

  async requestManualRun(
    projectId: string,
    occurredAt = nowInstant().epochMilliseconds,
  ): Promise<void> {
    await this.installer.commandDispatch.requestClustering({
      tenantId: projectId,
      occurredAt,
      trigger: "manual",
    });
  }
}
