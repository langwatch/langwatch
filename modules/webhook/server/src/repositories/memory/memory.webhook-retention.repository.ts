import type { WebhookRetentionRepository } from "../webhook-retention.repository.ts";
import type { MemoryWebhookDatabase } from "./memory.webhook-database.ts";

/**
 * The delivery-log sweep, over the same in-memory database the endpoint
 * registry shares. Idempotency receipts are not modelled in memory (nothing
 * in this package writes one outside Postgres), so that sweep is a no-op
 * that always answers zero.
 */
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
