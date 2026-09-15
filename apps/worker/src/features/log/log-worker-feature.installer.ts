import type { EventSubscriberDefinition } from "@langwatch/eventing";
import type { LogProcessingPipeline } from "@langwatch/log-server";
import type { LogProcessingEvent } from "@langwatch/log-contract";
import type { WorkerFeatureCloser, WorkerFeatureInstaller } from "../worker-feature.installer.ts";
import type { WorkerEventingRuntime } from "../../platform/eventing/worker-eventing.runtime.ts";

/** Log's worker-facing capability after its server graph is composed. */
export interface LogWorkerCapability {
  buildProcessing(options?: {
    subscribers?: EventSubscriberDefinition<LogProcessingEvent>[];
  }): LogProcessingPipeline;
}

/**
 * Worker registration for Log's durable processing pipeline.
 * Subscribers injected to handle cross-pipeline command dependencies.
 */
export class LogWorkerFeatureInstaller implements WorkerFeatureInstaller {
  static create(options: {
    installer: LogWorkerCapability;
    eventing: WorkerEventingRuntime;
    subscribers?: EventSubscriberDefinition<LogProcessingEvent>[];
  }): LogWorkerFeatureInstaller {
    return new LogWorkerFeatureInstaller(options.installer, options.eventing, options.subscribers);
  }

  readonly name = "log";
  private installed = false;

  private constructor(
    private readonly installer: LogWorkerCapability,
    private readonly eventing: WorkerEventingRuntime,
    private readonly subscribers: EventSubscriberDefinition<LogProcessingEvent>[] | undefined,
  ) {}

  async install(): Promise<WorkerFeatureCloser | undefined> {
    if (!this.installed) {
      this.eventing.eventSourcing.register(
        this.installer.buildProcessing({ subscribers: this.subscribers }),
      );
      this.installed = true;
    }
    return undefined;
  }
}
