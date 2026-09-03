import type { EventSubscriberDefinition } from "@langwatch/eventing";
import type { LogProcessingPipeline } from "@langwatch/log-server";
import type { LogProcessingEvent } from "@langwatch/log-contract";
import type { WorkerFeatureCloser, WorkerFeatureInstallerPort } from "../worker-feature.installer";
import type { WorkerEventingRuntime } from "../../platform/eventing/worker-eventing.runtime";

/** Log's worker-facing capability after its server graph is composed. */
export interface LogWorkerCapability {
  buildProcessing(options?: {
    subscribers?: EventSubscriberDefinition<LogProcessingEvent>[];
  }): LogProcessingPipeline;
}

/**
 * Worker registration for Log's durable processing pipeline.
 *
 * Subscribers are injected rather than resolved here. A dispatch subscriber
 * that feeds another pipeline's contribution commands has to close over
 * commands that only exist once that pipeline is registered, so the ordering
 * constraint belongs to the composition root that owns both — this installer
 * only guarantees that whatever it was given is mounted before queue
 * readiness.
 */
export class LogWorkerFeatureInstaller implements WorkerFeatureInstallerPort {
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
