import type { GatewayPersistenceTransaction } from "./gateway-change-events.port";

/**
 * One durable unit of work: a key write, its change event, and its audit row
 * land together or not at all — stated without the service holding a client.
 */
export abstract class GatewayTransactionPort {
  abstract run<T>(work: (transaction: GatewayPersistenceTransaction) => Promise<T>): Promise<T>;
}
