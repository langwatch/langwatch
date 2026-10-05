import type {
  GatewayPersistenceTransaction,
  GatewayTransactionRepository,
} from "../gateway-transaction.repository.ts";
import type { MemoryGatewayStore } from "./memory.gateway.store.ts";

/** One unit of work over the shared memory rows: a throw leaves them as they were. */
export class MemoryGatewayTransactionRepository implements GatewayTransactionRepository {
  static create(store: MemoryGatewayStore): MemoryGatewayTransactionRepository {
    return new MemoryGatewayTransactionRepository(store);
  }

  private constructor(private readonly store: MemoryGatewayStore) {}

  run<T>(work: (transaction: GatewayPersistenceTransaction) => Promise<T>): Promise<T> {
    return this.store.atomically(() => work({}));
  }
}
