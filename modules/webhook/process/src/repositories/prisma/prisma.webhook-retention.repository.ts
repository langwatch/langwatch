import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { nowInstant, toDate, type Instant } from "@langwatch/time";

import type { WebhookRetentionRepository } from "../webhook-retention.repository.ts";

/** The client slice the two sweeps use: both are raw statements, by design. */
export type WebhookRetentionDatabase = Pick<PrismaClient, "$executeRaw">;

/**
 * Delivery-log retention, honored identically by both webhook channels.
 * ADR-040 §6 bounds the automations log at 30 days and the endpoints platform
 * adopted the same bound; one table now holds both, so there is one number.
 */
export const WEBHOOK_DELIVERY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * The two system-owned maintenance sweeps the delivery log needs. Deliberately global and
 * deliberately raw.
 */
export class PrismaWebhookRetentionRepository implements WebhookRetentionRepository {
  private constructor(private readonly prisma: WebhookRetentionDatabase) {}

  static create({
    prisma,
  }: {
    prisma: WebhookRetentionDatabase;
  }): PrismaWebhookRetentionRepository {
    return new PrismaWebhookRetentionRepository(prisma);
  }

  /**
   * The one delivery-log prune. Deletes every attempt older than the retention
   * bound across both channels and returns the row count.
   */
  async pruneDeliveries({ now = nowInstant() }: { now?: Instant } = {}): Promise<number> {
    const before = toDate(now.subtract({ milliseconds: WEBHOOK_DELIVERY_RETENTION_MS }));
    return this.prisma.$executeRaw`
      DELETE FROM "WebhookEndpointDelivery"
      WHERE "firedAt" < ${before}
      -- @tenancy: webhook delivery-log retention sweep (system-owned maintenance)
    `;
  }

  /**
   * Drops idempotency receipts whose window has closed. Receipts expire lazily today: a key is
   * only re-examined when it is presented again, and a key that is never retried is never
   * revisited. That is correct for replay semantics and wrong for the table, which only grows.
   */
  async pruneExpiredIdempotencyReceipts({
    now = nowInstant(),
  }: { now?: Instant } = {}): Promise<number> {
    const cutoff = toDate(now);
    return this.prisma.$executeRaw`
      DELETE FROM "IdempotencyReceipt"
      WHERE "expiresAt" < ${cutoff}
      -- @tenancy: idempotency receipt expiry sweep (system-owned maintenance)
    `;
  }
}
