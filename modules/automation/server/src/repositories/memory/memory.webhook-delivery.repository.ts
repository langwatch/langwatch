import type { WebhookDeliveryInput, WebhookDeliveryRow } from "@langwatch/automation-contract";
import { generate } from "@langwatch/ksuid";
import { nowInstant, type Instant } from "@langwatch/time";
import { WebhookDeliveryRepository } from "../webhook-delivery.repository.ts";
import type { MemoryAutomationStore } from "./memory.automation.store.ts";

/** The same window the Postgres row is pruned on (ADR-040 §6). */
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export class MemoryWebhookDeliveryRepository extends WebhookDeliveryRepository {
  private constructor(private readonly memory: MemoryAutomationStore) {
    super();
  }

  static create(memory: MemoryAutomationStore): MemoryWebhookDeliveryRepository {
    return new MemoryWebhookDeliveryRepository(memory);
  }

  create(input: WebhookDeliveryInput): Promise<void> {
    this.memory.webhookDeliveries.push({
      projectId: input.projectId,
      row: {
        id: generate("webhookdelivery").toString(),
        triggerId: input.triggerId,
        dispatchId: input.dispatchId,
        responseStatus: input.responseStatus ?? null,
        latencyMs: input.latencyMs ?? null,
        error: input.error ?? null,
        response: input.response ?? null,
        outcome: input.outcome,
        firedAt: new Date(),
      },
    });
    return Promise.resolve();
  }

  findAllRecentByTriggerId(input: {
    projectId: string;
    triggerId: string;
    limit: number;
  }): Promise<WebhookDeliveryRow[]> {
    return Promise.resolve(
      this.memory.webhookDeliveries
        .filter(
          (entry) =>
            entry.projectId === input.projectId && entry.row.triggerId === input.triggerId,
        )
        .map((entry) => entry.row)
        .sort((left, right) => right.firedAt.getTime() - left.firedAt.getTime())
        .slice(0, input.limit),
    );
  }

  pruneExpired(now: Instant = nowInstant()): Promise<number> {
    const before = now.epochMilliseconds - RETENTION_MS;
    const kept = this.memory.webhookDeliveries.filter(
      (entry) => entry.row.firedAt.getTime() >= before,
    );
    const pruned = this.memory.webhookDeliveries.length - kept.length;
    this.memory.webhookDeliveries.splice(0, this.memory.webhookDeliveries.length, ...kept);
    return Promise.resolve(pruned);
  }
}
