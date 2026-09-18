import type { WebhookRetentionRepository } from "../webhook-retention.repository.ts";
import type { MemoryWebhookDatabase } from "./memory.webhook-database.ts";

export class MemoryWebhookRetentionRepository implements WebhookRetentionRepository {
  private constructor(private readonly database: MemoryWebhookDatabase) {}

  static create(input: { database: MemoryWebhookDatabase }): MemoryWebhookRetentionRepository {
    return new MemoryWebhookRetentionRepository(input.database);
  }

  async pruneDeliveries({ now = new Date() }: { now?: Date } = {}): Promise<number> {
    const before = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    return this.database.pruneDeliveriesBefore(before);
  }

  async pruneExpiredIdempotencyReceipts(): Promise<number> {
    return 0;
  }
}
