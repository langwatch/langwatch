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
 * Maintenance for the Eventing substrate itself: the Group Queue blob keyspace
 * and the process-manager inbox/outbox tables.
 *
 * Neither belongs to a product feature, and hanging either off a domain
 * pipeline's schedule is how retention ends up covering only that domain —
 * which is the failure that let the inbox reach 2.8M rows. They install
 * together and in this order because that is the order the live registry
 * mounts them in, and because both are unconditional: the substrate exists in
 * every worker whether or not any feature pipeline is registered.
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
