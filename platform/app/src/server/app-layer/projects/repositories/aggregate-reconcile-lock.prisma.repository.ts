/**
 * The per-aggregate reconcile lock, on the prior art of
 * `datasets/dataset-lock.ts` and `suites/plan-name-lock.ts`: a
 * transaction-scoped `pg_advisory_xact_lock` keyed by `hashtextextended` of a
 * namespaced id, so it serialises the reconciles of one aggregate across every
 * process and blocks nothing else.
 *
 * Unlike those two, the locked work does not run on the transaction: the
 * reconciler's attaches and revokes go through the grants event pipeline and
 * its projection, which write on connections of their own. The transaction
 * here only holds the lock, and commits empty once the reconcile returns. That
 * costs one pooled connection for the length of a reconcile, the projection
 * wait included, and the wait has to stay inside the lock: it is what makes
 * the next run read this run's rows rather than race them.
 *
 * A pinned connection whose work needs a second one from the same pool is the
 * self-deadlock `lwql/provisioning/selfProvisionLock.ts` warns about, and the
 * pg adapter's pool is ten connections that wait forever: ten reconciles at
 * once would pin all ten and starve their own bodies. So a process opens at
 * most {@link LOCKED_RECONCILES_PER_PROCESS} of these transactions at a time,
 * and the rest wait in memory, holding nothing.
 */
import type { PrismaClient } from "~/generated/prisma/client";
import { createSemaphore } from "~/server/experiments-v3/execution/semaphore";
import type { AggregateReconcileLock } from "./aggregate-rule.repository";

/**
 * Max wall-clock a reconcile may hold the lock, the wait for it included.
 * Sized for one batch of attaches and its one projection wait (eight seconds
 * at most), a revoke, and a run of the same aggregate queued in front of it
 * in another process. Prisma's 5s default would fail an ordinary reconcile
 * the moment the projection was slow.
 */
const AGGREGATE_RECONCILE_LOCK_TIMEOUT_MS = 60_000;

/** Max wall-clock to wait for a pooled connection before the lock is asked for. */
const AGGREGATE_RECONCILE_LOCK_MAX_WAIT_MS = 10_000;

/**
 * Pooled connections a process pins for reconcile locks at most. Reconciles
 * are rare (a join, a department move, a rule edit, the nightly sweep), so
 * queueing the third behind two costs little, and two pinned plus their two
 * bodies leave most of a ten-connection pool to everything else.
 */
const LOCKED_RECONCILES_PER_PROCESS = 2;

/** Per process, not per instance: the pool it protects is the process's. */
const lockedReconciles = createSemaphore(LOCKED_RECONCILES_PER_PROCESS);

export class PrismaAggregateReconcileLock implements AggregateReconcileLock {
  constructor(private readonly prisma: PrismaClient) {}

  async withAggregateLock<T>(
    { aggregateProjectId }: { aggregateProjectId: string },
    reconcile: () => Promise<T>,
  ): Promise<T> {
    await lockedReconciles.acquire();
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          // `$executeRaw`, not `$queryRaw`: pg_advisory_xact_lock returns
          // `void`, which $queryRaw cannot deserialise.
          await tx.$executeRaw`-- @tenancy: advisory-lock helper, the key names one aggregate project
SELECT pg_advisory_xact_lock(hashtextextended(${`aggregate-reconcile:${aggregateProjectId}`}, 0))`;
          return reconcile();
        },
        {
          timeout: AGGREGATE_RECONCILE_LOCK_TIMEOUT_MS,
          maxWait: AGGREGATE_RECONCILE_LOCK_MAX_WAIT_MS,
        },
      );
    } finally {
      lockedReconciles.release();
    }
  }
}
