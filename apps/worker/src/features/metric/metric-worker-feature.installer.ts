import type { EventSubscriberDefinition } from "@langwatch/eventing";
import type { MetricProcessingPipeline } from "@langwatch/metric-server";
import type { MetricProcessingEvent } from "@langwatch/metric-contract";
import type { WorkerFeatureCloser, WorkerFeatureInstaller } from "../worker-feature.installer.ts";
import type { WorkerEventingRuntime } from "../../platform/eventing/worker-eventing.runtime.ts";

/** Metric's worker-facing capability after its server graph is composed. */
export interface MetricWorkerCapability {
  buildProcessing(options?: {
    subscribers?: EventSubscriberDefinition<MetricProcessingEvent>[];
  }): MetricProcessingPipeline;
}

/**
 * Worker registration for Metric's durable processing pipeline.
 * Subscribers injected to handle cross-pipeline command dependencies.
 */
export class MetricWorkerFeatureInstaller implements WorkerFeatureInstaller {
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
