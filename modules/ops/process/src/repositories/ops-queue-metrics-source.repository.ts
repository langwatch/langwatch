import type {
  OpsBlockedSummary,
  OpsParkedTenantsPage,
  OpsQueueReconcileOutcome,
  QueueInfo,
} from "@langwatch/ops-contract";

/**
 * The queue reads the metrics writer makes, and nothing else - narrower than `OpsApi`, which
 * a process holding only Redis cannot compose. The operations service satisfies it as it stands.
 */
export abstract class OpsQueueMetricsSourceRepository {
  abstract discoverQueueNames(): Promise<string[]>;

  abstract scanQueues(input: { queueNames: string[] }): Promise<QueueInfo[]>;

  abstract reconcileQueuePending(input: { queueName: string }): Promise<OpsQueueReconcileOutcome>;

  abstract readQueuePendingDrift(input: { queueNames: string[] }): Promise<number>;

  abstract getBlockedQueueSummary(): Promise<OpsBlockedSummary>;

  abstract listParkedQueueTenants(input: {
    queueNames: string[];
    maxTenants: number;
  }): Promise<OpsParkedTenantsPage>;
}
