import { nowInstant, type Instant } from "@langwatch/time";

import type { WebhookRetentionRepository } from "../webhook-retention.repository.ts";
import type { MemoryWebhookDatabase } from "./memory.webhook-database.ts";

export class MemoryWebhookRetentionRepository implements WebhookRetentionRepository {
  private constructor(private readonly database: MemoryWebhookDatabase) {}

  static create(input: { database: MemoryWebhookDatabase }): MemoryWebhookRetentionRepository {
    return new MemoryWebhookRetentionRepository(input.database);
  }

  async pruneDeliveries({ now = nowInstant() }: { now?: Instant } = {}): Promise<number> {
    return this.database.pruneDeliveriesBefore(now.subtract({ hours: 30 * 24 }));
  }

  async pruneExpiredIdempotencyReceipts(): Promise<number> {
    return 0;
  }
}
