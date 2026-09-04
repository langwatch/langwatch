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
 * P2028 — the wait for the lock included. Sized larger than the dataset
 * lock's 120s: the body under the lock spans a queue of PostgreSQL DDL
 * statements AND a full round of ClickHouse access-model DDL (drop/recreate
 * user, mapped PostgreSQL-engine tables, grants, row policies) plus a
 * key-map backfill over every project, each a network round-trip to a
 * possibly-external ClickHouse.
 *
 * This budget bounds ONE pod's own wait-plus-run; it does NOT need to cover
 * an unbounded queue of other pods' convergences. If N pods boot together, a
 * tail pod that P2028s while still waiting for the lock is harmless: the
 * pod already holding the lock (or one ahead of it) completes the
 * convergence, every generator's DDL is idempotent, so that run alone
 * leaves the system fully converged. The timed-out pod simply skips running
 * it itself — nothing is lost, and the next boot (or the next self-provision
 * trigger) retries cheaply against already-converged state. The timeout
 * exists to bound an individual pod's wait, not to guarantee every pod gets
 * to run the convergence.
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
 *
 * REQUIRES a connection pool of at least 2 (`?connection_limit=2` or higher
 * on DATABASE_URL, or the driver's default — Prisma's classic engine
 * defaults to `cpus * 2 + 1`, well above 2). With `connection_limit=1`, `tx`
 * pins the pool's one connection for the lock's whole lifetime, and `fn`'s
 * work on the global `prisma` client then has no connection left to borrow —
 * it waits on the same pool the lock is holding, a self-deadlock that only
 * resolves when this transaction times out (P2028) at
 * `LWQL_SELF_PROVISION_TXN_TIMEOUT_MS`. `checkPoolSizeForSelfProvisionLock`
 * below fails fast with a clear error instead of that 300s hang whenever
 * DATABASE_URL's `connection_limit` is explicitly set to 1.
 */
export const withLwqlSelfProvisionLock = async <T>(
  { prisma }: { prisma: PrismaClient },
  fn: () => Promise<T>,
): Promise<T> => {
  checkPoolSizeForSelfProvisionLock(process.env.DATABASE_URL);
  return prisma.$transaction(
    async (tx) => {
      // `$executeRaw`, not `$queryRaw`: pg_advisory_xact_lock returns `void`,
      // which $queryRaw cannot deserialize. $executeRaw runs the statement and
      // takes the lock as a side effect. The `-- @tenancy:` opt-out is required
      // because this is a global boot lock with no tenancy predicate — exactly
      // as in dataset-lock.ts.
      await tx.$executeRaw`-- @tenancy: global self-provision boot lock, no tenant scope
SELECT pg_advisory_xact_lock(hashtextextended(${LWQL_SELF_PROVISION_LOCK_KEY}, 0))`;
      // The lock session would otherwise sit `idle in transaction` for the
      // whole (possibly minutes-long) convergence in `fn` below — it does
      // real work on OTHER connections (the global `prisma` client, a
      // separate ClickHouse client), not on `tx`. An operator-set
      // `idle_in_transaction_session_timeout` measures exactly that idle
      // time and would kill this session mid-convergence, silently
      // releasing the advisory lock and letting a second pod race in while
      // the first is still mutating the ClickHouse access model. `SET
      // LOCAL` scopes the override to this transaction only, so it never
      // weakens the setting anywhere else.
      await tx.$executeRaw`-- @tenancy: global self-provision boot lock session setting, no tenant scope
SET LOCAL idle_in_transaction_session_timeout = 0`;
      return fn();
    },
    {
      timeout: LWQL_SELF_PROVISION_TXN_TIMEOUT_MS,
      maxWait: LWQL_SELF_PROVISION_TXN_MAX_WAIT_MS,
    },
  );
};

/**
 * Fails fast when DATABASE_URL explicitly caps the pool at 1 connection —
 * see the `REQUIRES a connection pool of at least 2` note above. Only acts
 * on an explicit `connection_limit=1`; an absent or unparsable param is left
 * alone (the driver's own default is never 1). Cheap and dependency-free: a
 * bare `URL`/`URLSearchParams` parse, no new import.
 */
export function checkPoolSizeForSelfProvisionLock(
  databaseUrl: string | undefined,
): void {
  if (!databaseUrl) return;
  let connectionLimit: string | null;
  try {
    connectionLimit = new URL(databaseUrl).searchParams.get(
      "connection_limit",
    );
  } catch {
    return;
  }
  if (connectionLimit === "1") {
    throw new Error(
      "LWQL self-provision lock requires a connection pool of at least 2 " +
        "(DATABASE_URL has connection_limit=1). With a pool of 1, the " +
        "advisory-lock transaction pins the only connection and the " +
        "convergence body — which runs on a separate pool checkout — can " +
        "never acquire one, self-deadlocking until the transaction times " +
        "out. Raise connection_limit to 2 or more.",
    );
  }
}
