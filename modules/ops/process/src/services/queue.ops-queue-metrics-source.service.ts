import type {
  OpsBlockedSummary,
  OpsParkedTenantsPage,
  OpsQueueReconcileOutcome,
  QueueInfo,
} from "@langwatch/ops-contract";

import { OpsQueueMetricsSourceRepository } from "../repositories/ops-queue-metrics-source.repository.ts";
import type { QueueService } from "./queue.service.ts";

/** The writer's queue reads over the queue service alone, for a process with no Postgres. */
export class QueueOpsMetricsSourceService extends OpsQueueMetricsSourceRepository {
  static create(queues: QueueService): QueueOpsMetricsSourceService {
    return new QueueOpsMetricsSourceService(queues);
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

  reconcileQueuePending(input: { queueName: string }): Promise<OpsQueueReconcileOutcome> {
    return this.queues.reconcilePending(input);
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
