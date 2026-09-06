import type {
  OpsBlockedSummary,
  OpsParkedTenantsPage,
  OpsQueueReconcileResult,
  QueueInfo,
} from "@langwatch/ops-contract";

/**
 * The queue reads the metrics writer makes, and nothing else — narrower than `OpsService`, which
 * a process holding only Redis cannot compose. An `OpsService` satisfies it as it stands.
 */
export abstract class OpsQueueMetricsSourcePort {
  abstract discoverQueueNames(): Promise<string[]>;

  abstract scanQueues(input: { queueNames: string[] }): Promise<QueueInfo[]>;

  abstract tryReconcileQueuePending(input: {
    queueName: string;
  }): Promise<OpsQueueReconcileResult | null>;

  abstract readQueuePendingDrift(input: { queueNames: string[] }): Promise<number>;

  abstract getBlockedQueueSummary(): Promise<OpsBlockedSummary>;

  abstract listParkedQueueTenants(input: {
    queueNames: string[];
    maxTenants: number;
  }): Promise<OpsParkedTenantsPage>;
}
