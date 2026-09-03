import type { EventSubscriberDefinition } from "@langwatch/eventing";
import type { MetricProcessingPipeline } from "@langwatch/metric-server";
import type { MetricProcessingEvent } from "@langwatch/metric-contract";
import { WorkerFeatureHandlePort, WorkerFeatureInstallerPort } from "../worker-feature.installer";
import type { WorkerEventingRuntime } from "../../platform/eventing/worker-eventing.runtime";

/** Metric's worker-facing capability after its server graph is composed. */
export interface MetricWorkerCapability {
  buildProcessing(options?: {
    subscribers?: EventSubscriberDefinition<MetricProcessingEvent>[];
  }): MetricProcessingPipeline;
}

/**
 * Worker registration for Metric's durable processing pipeline.
 *
 * Subscribers are injected rather than resolved here. A dispatch subscriber
 * that feeds another pipeline's contribution commands has to close over
 * commands that only exist once that pipeline is registered, so the ordering
 * constraint belongs to the composition root that owns both — this installer
 * only guarantees that whatever it was given is mounted before queue
 * readiness.
 */
export class MetricWorkerFeatureInstaller extends WorkerFeatureInstallerPort {
  static create(options: {
    installer: MetricWorkerCapability;
    eventing: WorkerEventingRuntime;
    subscribers?: EventSubscriberDefinition<MetricProcessingEvent>[];
  }): MetricWorkerFeatureInstaller {
    return new MetricWorkerFeatureInstaller(
      options.installer,
      options.eventing,
      options.subscribers,
    );
  }

  readonly name = "metric";
  private installed = false;

  private constructor(
    private readonly installer: MetricWorkerCapability,
    private readonly eventing: WorkerEventingRuntime,
    private readonly subscribers: EventSubscriberDefinition<MetricProcessingEvent>[] | undefined,
  ) {
    super();
  }

  async install(): Promise<WorkerFeatureHandlePort> {
    if (!this.installed) {
      this.eventing.eventSourcing.register(
        this.installer.buildProcessing({ subscribers: this.subscribers }),
      );
      this.installed = true;
    }
    return MetricWorkerFeatureHandle.create();
  }
}

class MetricWorkerFeatureHandle extends WorkerFeatureHandlePort {
  static create(): MetricWorkerFeatureHandle {
    return new MetricWorkerFeatureHandle();
  }

  private constructor() {
    super();
  }

  async close(): Promise<void> {}
}
