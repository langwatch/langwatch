import type { GatewayPersistenceTransaction } from "./gateway-change-events.port";

/**
 * One durable unit of work. A key write, the change event the gateway's
 * long-poll reads it from and the audit row a human reads it from land
 * together or not at all, and a service states that without holding the
 * database client that makes it true.
 */
export abstract class GatewayTransactionPort {
  abstract run<T>(work: (transaction: GatewayPersistenceTransaction) => Promise<T>): Promise<T>;
}
