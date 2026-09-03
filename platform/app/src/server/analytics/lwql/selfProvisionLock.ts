/**
 * A single Postgres advisory lock that serializes the `LWQL_SELF_PROVISION`
 * convergence across concurrently-booting app pods.
 *
 * `provisionLwql`'s `selfProvisionAll` runs at boot on EVERY pod (during
 * `start:prepare:db`). On the self-provision path it drives a DESTRUCTIVE
 * convergence: PostgreSQL approved-view + reader-role statements, then
 * ClickHouse `CREATE USER OR REPLACE` / drop+recreate PostgreSQL-engine tables
 * / grants / row policies, then a key-map backfill. Run by several pods at
 * once with no coordination, these sequences race — one pod recreating the
 * restricted user and its mapped tables while another queries through them
 * mid-drop. The convergence is a SINGLETON (one global model, not per-tenant),
 * so a single global lock is the right granularity.
 *
 * This mirrors the prior art in `datasets/dataset-lock.ts`,
 * `suites/plan-name-lock.ts` and `modelProviders/modelDefaults.repository.ts`:
 * a transaction-scoped `pg_advisory_xact_lock` keyed by `hashtextextended` of a
 * namespaced string. The one difference is the key — a CONSTANT global string,
 * not a per-entity one — because there is exactly one convergence to serialize.
 *
 * The lock is BLOCKING (`pg_advisory_xact_lock`, never the `try_` variant): a
 * pod that arrives while another holds the lock must WAIT and then run the
 * convergence itself, so convergence is guaranteed rather than skipped.
 * Re-running is safe because every generator emits idempotent DDL
 * (`CREATE ... OR REPLACE`, `IF NOT EXISTS`, drop-if-exists).
 *
 * Only the transaction connection needs to HOLD the lock. `fn`'s body does its
 * real work on the global `prisma` client and a separate `@clickhouse/client`
 * connection — deliberately NOT on `tx`. That is correct: the lock's job is to
 * gate ENTRY into the convergence, and every other pod blocks on acquiring the
 * same advisory lock before it can start its own work, so the destructive
 * sequence is serialized machine-wide even though the PG statements and the
 * ClickHouse DDL run on other connections. Routing the ClickHouse work through
 * `tx` is impossible (different datastore) and unnecessary.
 *
 * @see ../../../tasks/provisionLwql.ts — the sole caller (`selfProvisionAll`)
 * @see ../../datasets/dataset-lock.ts — the canonical advisory-lock idiom
 */
import type { PrismaClient } from "~/generated/prisma/client";

/**
 * The constant, global lock key. Namespaced like the per-entity keys in the
 * prior art, but with no entity suffix — the self-provision convergence is a
 * singleton, so all pods contend for one lock.
 */
export const LWQL_SELF_PROVISION_LOCK_KEY = "lwql:self-provision";

/**
 * Max wall-clock the locked transaction may run before Prisma aborts it with
 * P2028 — the wait for the lock included. Sized larger than the dataset lock's
 * 120s: the body under the lock spans a queue of PostgreSQL DDL statements AND
 * a full round of ClickHouse access-model DDL (drop/recreate user, mapped
 * PostgreSQL-engine tables, grants, row policies) plus a key-map backfill over
 * every project, each a network round-trip to a possibly-external ClickHouse.
 * When N pods boot together the tail pod waits through (N-1) full convergences
 * before its own, so the budget must cover the queue, not just one pass. Prisma's
 * 5s interactive-txn default would P2028 the moment two pods contend. 300s
 * bounds a genuinely wedged transaction while giving a slow external ClickHouse
 * ample headroom.
 */
export const LWQL_SELF_PROVISION_TXN_TIMEOUT_MS = 300_000;

/**
 * Max wall-clock to WAIT for a connection from the pool before the transaction
 * starts (separate from the run timeout above). Bumped well above Prisma's 2s
 * default so a busy boot-time pool does not fail acquisition before the
 * convergence even begins.
 */
export const LWQL_SELF_PROVISION_TXN_MAX_WAIT_MS = 30_000;

/**
 * Run `fn` inside a `$transaction` that first acquires the global
 * self-provision advisory lock, then awaits `fn`. The lock is held for the
 * whole transaction, so concurrent pods block at the `SELECT` below until the
 * current holder's transaction ends, then acquire it and run the (idempotent)
 * convergence themselves. This is the real serialization the P1 asks for.
 *
 * `fn` takes no transaction client on purpose: its work runs on the global
 * `prisma` client and a separate ClickHouse connection (see the module
 * doc-comment). Whatever `fn` throws propagates out of the `$transaction` and
 * must be caught by the caller's existing non-fatal handler so a provisioning
 * failure never crashes the boot.
 */
export const withLwqlSelfProvisionLock = async <T>(
  { prisma }: { prisma: PrismaClient },
  fn: () => Promise<T>,
): Promise<T> =>
  prisma.$transaction(
    async (tx) => {
      // `$executeRaw`, not `$queryRaw`: pg_advisory_xact_lock returns `void`,
      // which $queryRaw cannot deserialize. $executeRaw runs the statement and
      // takes the lock as a side effect. The `-- @tenancy:` opt-out is required
      // because this is a global boot lock with no tenancy predicate — exactly
      // as in dataset-lock.ts.
      await tx.$executeRaw`-- @tenancy: global self-provision boot lock, no tenant scope
SELECT pg_advisory_xact_lock(hashtextextended(${LWQL_SELF_PROVISION_LOCK_KEY}, 0))`;
      return fn();
    },
    {
      timeout: LWQL_SELF_PROVISION_TXN_TIMEOUT_MS,
      maxWait: LWQL_SELF_PROVISION_TXN_MAX_WAIT_MS,
    },
  );
