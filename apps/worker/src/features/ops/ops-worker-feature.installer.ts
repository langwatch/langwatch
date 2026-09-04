import type { OpsWorkerPort, StorageStatsCollectionService } from "@langwatch/ops-server";
import type { WorkerFeatureCloser, WorkerFeatureInstallerPort } from "../worker-feature.installer";

/**
 * Worker registration for the three operational loops.
 *
 * One installer rather than three, because they share a single condition — a
 * process that owns them owns all three — and because each is a timer rather
 * than a routing key, so nothing about their order relative to a pipeline
 * matters. What does matter is that every handle they hand back is stopped:
 * a timer left running past shutdown holds the process open past its deadline.
 *
 * Two of the three can decline to start on their own terms and say so:
 * anomaly detection needs the queue's Redis, and the usage report is off on
 * SaaS and wherever an operator turned it off. A declined start is `undefined`
 * here rather than an error, and there is nothing to stop.
 */
export class OpsWorkerFeatureInstaller implements WorkerFeatureInstallerPort {
  static create(options: {
    workers: OpsWorkerPort;
    storageStats: StorageStatsCollectionService | undefined;
  }): OpsWorkerFeatureInstaller {
    return new OpsWorkerFeatureInstaller(options);
  }

  readonly name = "ops";

  private constructor(
    private readonly options: {
      workers: OpsWorkerPort;
      storageStats: StorageStatsCollectionService | undefined;
    },
  ) {}

  install(): Promise<WorkerFeatureCloser | undefined> {
    const anomaly = this.options.workers.startAnomalyWorker();
    const usageStats = this.options.workers.startUsageStatsWorker();
    const storageStats = this.options.storageStats?.start();

    return Promise.resolve(async () => {
      storageStats?.stop();
      await usageStats?.stop();
      await anomaly?.stop();
    });
  }
}
