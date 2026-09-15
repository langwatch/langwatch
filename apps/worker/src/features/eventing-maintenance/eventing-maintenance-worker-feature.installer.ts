import type { BlobSweepReport } from "@langwatch/group-queue/operational";
import {
  createBlobMaintenancePipeline,
  createProcessManagerMaintenancePipeline,
  type ProcessRetentionMetrics,
} from "@langwatch/eventing/server";
import type { WorkerFeatureCloser, WorkerFeatureInstaller } from "../worker-feature.installer.ts";
import type { WorkerEventingRuntime } from "../../platform/eventing/worker-eventing.runtime.ts";

/** The queue-owned blob keyspace pass, injected because the sweeper holds Redis. */
export abstract class WorkerBlobSweep {
  abstract sweep(): Promise<BlobSweepReport>;
}

/**
 * Maintenance for the Eventing substrate: Group Queue blob keyspace and
 * process-manager inbox/outbox tables. Unconditional (not tied to a domain pipeline).
 */
export class EventingMaintenanceWorkerFeatureInstaller implements WorkerFeatureInstaller {
  static create(options: {
    eventing: WorkerEventingRuntime;
    blobSweep: WorkerBlobSweep;
    retentionMetrics: ProcessRetentionMetrics;
  }): EventingMaintenanceWorkerFeatureInstaller {
    return new EventingMaintenanceWorkerFeatureInstaller(
      options.eventing,
      options.blobSweep,
      options.retentionMetrics,
    );
  }

  readonly name = "eventing-maintenance";
  private installed = false;

  private constructor(
    private readonly eventing: WorkerEventingRuntime,
    private readonly blobSweep: WorkerBlobSweep,
    private readonly retentionMetrics: ProcessRetentionMetrics,
  ) {}

  async install(): Promise<WorkerFeatureCloser | undefined> {
    if (!this.installed) {
      const processStore = this.eventing.processStore;
      this.eventing.eventSourcing.register(
        createBlobMaintenancePipeline({
          cleanup: {
            sweep: () => this.blobSweep.sweep(),
            deleteDispatchedBefore: (params) => processStore.deleteDispatchedBefore(params),
          },
        }),
      );
      // Reaps by predicate across every processName, so it covers the
      // processes nobody registered and every process added later.
      this.eventing.eventSourcing.register(
        createProcessManagerMaintenancePipeline({
          retentionSweep: {
            deleteDispatchedOutboxBatch: (params) =>
              processStore.deleteDispatchedOutboxBatch(params),
            deleteDeadOutboxBatch: (params) => processStore.deleteDeadOutboxBatch(params),
            deleteConsumedInboxBatch: (params) => processStore.deleteConsumedInboxBatch(params),
            metrics: this.retentionMetrics,
          },
        }),
      );
      this.installed = true;
    }
    return undefined;
  }
}
