/** Opaque transaction hand-off; only the Prisma adapter interprets it. */
export type GatewayPersistenceTransaction = object;

/**
 * One durable unit of work: a key write, its change event, and its audit row
 * land together or not at all — stated without the service holding a client.
 */
export interface GatewayTransactionRepository {
  run<T>(work: (transaction: GatewayPersistenceTransaction) => Promise<T>): Promise<T>;
}
