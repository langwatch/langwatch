// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { AggregateReconcileLockRepository } from "../aggregate-reconcile-lock.repository.ts";

/** The lock twin: reconciles of one aggregate queue behind each other in this process. */
export class MemoryAggregateReconcileLockRepository extends AggregateReconcileLockRepository {
  private readonly tails = new Map<string, Promise<unknown>>();

  static create(): MemoryAggregateReconcileLockRepository {
    return new MemoryAggregateReconcileLockRepository();
  }

  async withAggregateLock<T>({
    aggregateProjectId,
    reconcile,
  }: {
    aggregateProjectId: string;
    reconcile: () => Promise<T>;
  }): Promise<T> {
    const previous = this.tails.get(aggregateProjectId) ?? Promise.resolve();
    const run = previous.then(reconcile, reconcile);
    const tail = run.catch(() => undefined);
    this.tails.set(aggregateProjectId, tail);
    try {
      return await run;
    } finally {
      if (this.tails.get(aggregateProjectId) === tail) this.tails.delete(aggregateProjectId);
    }
  }
}
