// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { ConcurrencyLimiter } from "@langwatch/limiter";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import { AggregateReconcileLockRepository } from "../aggregate-reconcile-lock.repository.ts";

/** Holds the lock for a reconcile, its projection wait included; Prisma's 5s default is too short. */
const AGGREGATE_RECONCILE_LOCK_TIMEOUT_MS = 60_000;
const AGGREGATE_RECONCILE_LOCK_MAX_WAIT_MS = 10_000;

/**
 * Per process: the locked body writes on other pooled connections, so pinning the
 * whole pool with lock transactions would starve those bodies (a self-deadlock).
 */
const lockedReconciles = new ConcurrencyLimiter({ maxConcurrent: 2 });

/** A transaction-scoped advisory lock keyed by the aggregate; the transaction itself writes nothing. */
export class PrismaAggregateReconcileLockRepository extends AggregateReconcileLockRepository {
  private constructor(private readonly prisma: PrismaClient) {
    super();
  }

  static create(prisma: PrismaClient): PrismaAggregateReconcileLockRepository {
    return new PrismaAggregateReconcileLockRepository(prisma);
  }

  async withAggregateLock<T>({
    aggregateProjectId,
    reconcile,
  }: {
    aggregateProjectId: string;
    reconcile: () => Promise<T>;
  }): Promise<T> {
    return lockedReconciles.run({
      task: () =>
        this.prisma.$transaction(
          async (transaction) => {
            await transaction.$executeRaw`-- @tenancy: advisory-lock helper, the key names one aggregate project
SELECT pg_advisory_xact_lock(hashtextextended(${`aggregate-reconcile:${aggregateProjectId}`}, 0))`;
            return reconcile();
          },
          {
            timeout: AGGREGATE_RECONCILE_LOCK_TIMEOUT_MS,
            maxWait: AGGREGATE_RECONCILE_LOCK_MAX_WAIT_MS,
          },
        ),
    });
  }
}
