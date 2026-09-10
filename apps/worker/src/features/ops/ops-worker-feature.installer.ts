import type { OpsWorker, StorageStatsCollectionService } from "@langwatch/ops-server";
import type {
  WorkerFeatureCloser,
  WorkerFeatureInstaller,
} from "../worker-feature.installer.ts";

/**
 * Worker registration for the operational loops. One installer rather than one each, because
 * they share a single condition — a process that owns them owns every one — and because each is a
 * timer rather than a routing key, so nothing about their order relative to a pipeline matters.
 */
export class OpsWorkerFeatureInstaller implements WorkerFeatureInstaller {
  static create(options: {
    workers: OpsWorker;
    storageStats: StorageStatsCollectionService | undefined;
  }): OpsWorkerFeatureInstaller {
    return new OpsWorkerFeatureInstaller(options);
  }

  readonly name = "ops";

  private constructor(
    private readonly options: {
      workers: OpsWorker;
      storageStats: StorageStatsCollectionService | undefined;
    },
  ) {}

  install(): Promise<WorkerFeatureCloser | undefined> {
    const anomaly = this.options.workers.tryStartAnomalyWorker();
    const usageStats = this.options.workers.tryStartUsageStatsWorker();
    const queueMetrics = this.options.workers.tryStartQueueMetricsWriter();
    const storageStats = this.options.storageStats?.start();

    return Promise.resolve(async () => {
      storageStats?.stop();
      await queueMetrics?.stop();
      await usageStats?.stop();
      await anomaly?.stop();
    });
  }
}
