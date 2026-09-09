import type { PrismaClient } from "@langwatch/prisma-client/generated";

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
export class PrismaWebhookRetentionRepository {
  private constructor(private readonly prisma: PrismaClient) {}

  static create({ prisma }: { prisma: PrismaClient }): PrismaWebhookRetentionRepository {
    return new PrismaWebhookRetentionRepository(prisma);
  }

  /**
   * The one delivery-log prune. Deletes every attempt older than the retention
   * bound across both channels and returns the row count.
   */
  async pruneDeliveries({ now = new Date() }: { now?: Date } = {}): Promise<number> {
    const before = new Date(now.getTime() - WEBHOOK_DELIVERY_RETENTION_MS);
    return await this.prisma.$executeRaw`
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
    now = new Date(),
  }: { now?: Date } = {}): Promise<number> {
    return await this.prisma.$executeRaw`
      DELETE FROM "IdempotencyReceipt"
      WHERE "expiresAt" < ${now}
      -- @tenancy: idempotency receipt expiry sweep (system-owned maintenance)
    `;
  }
}
