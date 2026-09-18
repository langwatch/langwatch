/**
 * The delivery log's two system-owned maintenance sweeps, honored identically
 * by both webhook channels (ADR-040 §6): the 30-day delivery-attempt prune
 * and the idempotency-receipt expiry sweep.
 */
export interface WebhookRetentionRepository {
  pruneDeliveries(input?: { now?: Date }): Promise<number>;
  pruneExpiredIdempotencyReceipts(input?: { now?: Date }): Promise<number>;
}
