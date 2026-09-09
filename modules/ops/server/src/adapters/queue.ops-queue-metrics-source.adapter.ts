import type {
  OpsBlockedSummary,
  OpsParkedTenantsPage,
  OpsQueueReconcileResult,
  QueueInfo,
} from "@langwatch/ops-contract";
import { OpsQueueMetricsSourcePort } from "../ports/ops-queue-metrics-source.port.ts";
import type { QueueService } from "../services/queue.service.ts";

/** The writer's queue reads over the queue service alone, for a process with no Postgres. */
export class QueueOpsMetricsSourceAdapter extends OpsQueueMetricsSourcePort {
  static create(queues: QueueService): QueueOpsMetricsSourceAdapter {
    return new QueueOpsMetricsSourceAdapter(queues);
  }

  private constructor(private readonly queues: QueueService) {
    super();
  }

  discoverQueueNames(): Promise<string[]> {
    return this.queues.discoverQueueNames();
  }

  scanQueues(input: { queueNames: string[] }): Promise<QueueInfo[]> {
    return this.queues.scanQueues(input);
  }

  tryReconcileQueuePending(input: { queueName: string }): Promise<OpsQueueReconcileResult | null> {
    return this.queues.tryReconcilePending(input);
  }

  readQueuePendingDrift(input: { queueNames: string[] }): Promise<number> {
    return this.queues.readPublishedPendingDrift(input);
  }

  getBlockedQueueSummary(): Promise<OpsBlockedSummary> {
    return this.queues.getBlockedSummary();
  }

  listParkedQueueTenants(input: {
    queueNames: string[];
    maxTenants: number;
  }): Promise<OpsParkedTenantsPage> {
    return this.queues.listParkedTenants(input);
  }
}
