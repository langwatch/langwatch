// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/** Serialises the reconciles of one aggregate project (ADR-177): one at a time per aggregate. */
export abstract class AggregateReconcileLockRepository {
  abstract withAggregateLock<T>(input: {
    aggregateProjectId: string;
    reconcile: () => Promise<T>;
  }): Promise<T>;
}
