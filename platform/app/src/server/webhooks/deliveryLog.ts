import type { PrismaClient } from "~/generated/prisma/client";

/**
 * Delivery-log retention, honored identically by both webhook channels.
 * ADR-040 §6 bounds the automations log at 30 days and the endpoints platform
 * adopted the same bound; one table now holds both, so there is one number.
 */
export const WEBHOOK_DELIVERY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * The one delivery-log prune. Deletes every attempt older than the retention
 * bound across both channels and returns the row count.
 *
 * Deliberately global and deliberately raw. The two channels used to prune
 * differently: the platform swept the whole table in one statement, while the
 * automations side enumerated every Project and issued one delete per tenant,
 * purely because the Prisma tenancy guard refuses a cross-tenant deleteMany.
 * That loop cost one statement per project to delete rows nobody is scoped to
 * read anyway. Retention is system-owned maintenance, not a tenant operation,
 * so it takes the raw-SQL opt-out the guard provides and states why inline.
 */
export async function pruneWebhookDeliveries({
  prisma,
  now = new Date(),
}: {
  prisma: PrismaClient;
  now?: Date;
}): Promise<number> {
  const before = new Date(now.getTime() - WEBHOOK_DELIVERY_RETENTION_MS);
  return await prisma.$executeRaw`
    DELETE FROM "WebhookEndpointDelivery"
    WHERE "firedAt" < ${before}
    -- @tenancy: webhook delivery-log retention sweep (system-owned maintenance)
  `;
}

/**
 * Drops idempotency receipts whose window has closed.
 *
 * Receipts expire lazily today: a key is only re-examined when it is presented
 * again, and a key that is never retried is never revisited. That is correct for
 * replay semantics and wrong for the table, which only grows. The `expiresAt`
 * index exists precisely so a sweep can do this in bulk, and nothing was calling
 * it. Returns the row count.
 */
export async function pruneExpiredIdempotencyReceipts({
  prisma,
  now = new Date(),
}: {
  prisma: PrismaClient;
  now?: Date;
}): Promise<number> {
  return await prisma.$executeRaw`
    DELETE FROM "IdempotencyReceipt"
    WHERE "expiresAt" < ${now}
    -- @tenancy: idempotency receipt expiry sweep (system-owned maintenance)
  `;
}
