/**
 * One-time catch-up purge of the ProcessManager inbox and outbox backlog
 * (one-shot prod ops tool).
 *
 * The hourly `processRetentionSweep` process manager holds these tables at
 * their steady state, but its bounded batches are sized for an hour of traffic,
 * not for a multi-million-row historical backlog. This script clears that
 * backlog in `ctid` batches, which need no index and so can run before the
 * retention migration builds one.
 *
 * DRY-RUN BY DEFAULT: counts what it would delete and stops. Re-run with
 * APPLY=1 to delete. Safe to re-run and safe to interrupt: every batch is its
 * own statement, so stopping halfway simply leaves the rest of the backlog for
 * the next run or for the sweep.
 *
 * Pending and dead outbox rows are never touched. Pending rows are work still
 * owed; dead rows are the operator's failure record.
 *
 * Usage (inside an app pod, which already has the Prisma client and the
 * database credentials):
 *   kubectl --context <ctx> -n langwatch exec -it deploy/langwatch-app -- \
 *     node scripts/ops/purge-process-manager-tables.mjs
 *   kubectl --context <ctx> -n langwatch exec -it deploy/langwatch-app -- \
 *     env APPLY=1 node scripts/ops/purge-process-manager-tables.mjs
 *
 * Env overrides: RETENTION_DAYS (7), BATCH_SIZE (10000), SLEEP_MS (200),
 * MAX_BATCHES (10000). Each is validated before anything runs, see `intEnv`.
 */

import { PrismaClient } from "@prisma/client";

/** A whole number and nothing else: no hex, no exponent, no decimal point. */
const INTEGER_PATTERN = /^[+-]?\d+$/;

/**
 * Reads one integer override, failing closed on anything unusable.
 *
 * Unset or empty takes the fallback. Everything else must be a whole number of
 * at least `min`, or the script prints why and exits before it opens a
 * connection. These values go straight into the retention predicate and the
 * batch bounds, where a quiet coercion is destructive: `RETENTION_DAYS=0` would
 * make the window `now()`, which is every dispatched and consumed row in both
 * tables, `RETENTION_DAYS=7d` would reach the database as `NaN` and abort
 * mid-run, and `BATCH_SIZE=0` would delete nothing while reporting success.
 *
 * @param {string} name
 * @param {number} fallback
 * @param {number} min
 * @returns {number}
 */
function intEnv(name, fallback, min) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;

  const trimmed = raw.trim();
  const value = INTEGER_PATTERN.test(trimmed) ? Number(trimmed) : Number.NaN;
  if (!Number.isSafeInteger(value) || value < min) {
    console.error(
      `ERROR: ${name}="${raw}" is not usable. Pass a whole number of at ` +
        `least ${min}, or leave it unset to use ${fallback}. Nothing was deleted.`,
    );
    process.exit(1);
  }
  return value;
}

const APPLY = process.env.APPLY === "1";
const RETENTION_DAYS = intEnv("RETENTION_DAYS", 7, 1);
const BATCH_SIZE = intEnv("BATCH_SIZE", 10_000, 1);
const SLEEP_MS = intEnv("SLEEP_MS", 200, 0);
const MAX_BATCHES = intEnv("MAX_BATCHES", 10_000, 1);

const prisma = new PrismaClient();

/** @param {number} ms */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The two backlogs, each as the `ctid` batch delete and the matching count.
 * The predicates are the runbook's, one retention window wider than the
 * sweep's, so this only ever removes rows the sweep would also remove.
 *
 * Every value is bound, never interpolated. `intEnv` above already rejects
 * anything that is not a whole number, but a validated value spliced into SQL
 * is still a shape that only stays safe while the validation two screens up
 * keeps matching the splice, and the next override added here would not
 * necessarily be an integer. Binding removes the question.
 *
 * @type {Array<{ name: string, countEligible: () => Promise<unknown>, deleteBatch: () => Promise<number> }>}
 */
const TARGETS = [
  {
    name: "ProcessManagerOutbox (dispatched)",
    countEligible: () => prisma.$queryRaw`
      SELECT count(*)::bigint AS n FROM "ProcessManagerOutbox"
      WHERE "status" = 'dispatched'
        AND "dispatchedAt" < now() - (${RETENTION_DAYS}::int * interval '1 day')`,
    deleteBatch: () => prisma.$executeRaw`
      WITH batch AS (
        SELECT ctid FROM "ProcessManagerOutbox"
        WHERE "status" = 'dispatched'
          AND "dispatchedAt" < now() - (${RETENTION_DAYS}::int * interval '1 day')
        LIMIT ${BATCH_SIZE}
      )
      DELETE FROM "ProcessManagerOutbox" o USING batch WHERE o.ctid = batch.ctid`,
  },
  {
    name: "ProcessManagerInbox (consumed)",
    countEligible: () => prisma.$queryRaw`
      SELECT count(*)::bigint AS n FROM "ProcessManagerInbox"
      WHERE "consumedAt" < now() - (${RETENTION_DAYS}::int * interval '1 day')`,
    deleteBatch: () => prisma.$executeRaw`
      WITH batch AS (
        SELECT ctid FROM "ProcessManagerInbox"
        WHERE "consumedAt" < now() - (${RETENTION_DAYS}::int * interval '1 day')
        LIMIT ${BATCH_SIZE}
      )
      DELETE FROM "ProcessManagerInbox" i USING batch WHERE i.ctid = batch.ctid`,
  },
];

/**
 * @param {(typeof TARGETS)[number]} target
 * @returns {Promise<number>}
 */
async function countEligible(target) {
  const rows = /** @type {Array<{ n: unknown }>} */ (
    await target.countEligible()
  );
  return Number(rows[0]?.n ?? 0);
}

/**
 * Deletes one target in batches until it runs dry or the batch ceiling hits.
 *
 * @param {(typeof TARGETS)[number]} target
 * @returns {Promise<number>}
 */
async function purge(target) {
  let total = 0;
  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const deleted = await target.deleteBatch();
    total += deleted;
    if (deleted === 0) return total;
    if (batch % 10 === 0) console.log(`  ... ${total} rows deleted so far`);
    await sleep(SLEEP_MS);
  }
  console.warn(
    `  WARN: stopped at MAX_BATCHES=${MAX_BATCHES} with rows still eligible. Re-run to continue.`,
  );
  return total;
}

async function main() {
  console.log(
    `mode=${APPLY ? "APPLY" : "DRY-RUN"} retention_days=${RETENTION_DAYS} ` +
      `batch_size=${BATCH_SIZE} sleep_ms=${SLEEP_MS}`,
  );

  for (const target of TARGETS) {
    const eligible = await countEligible(target);
    console.log(`${target.name}: ${eligible} eligible rows`);
    if (!APPLY) continue;
    const deleted = await purge(target);
    console.log(`${target.name}: deleted ${deleted} rows`);
  }

  if (!APPLY) {
    console.log("DRY-RUN only. Re-run with APPLY=1 to delete.");
    return;
  }

  // A plain VACUUM marks the pages reusable so Postgres refills them instead of
  // extending the files. VACUUM FULL would reclaim the space but takes an
  // ACCESS EXCLUSIVE lock on tables the automations pipeline writes to
  // continuously, so it is never the right trade here.
  console.log("vacuuming (this does not shrink the files, by design) ...");
  // The one statement that cannot be bound: Postgres takes no parameter in an
  // identifier position, and VACUUM takes no parameters at all. Both names are
  // literals in this line, so nothing outside this file reaches the string.
  for (const table of ["ProcessManagerOutbox", "ProcessManagerInbox"]) {
    await prisma.$executeRawUnsafe(`VACUUM (ANALYZE) "${table}"`);
  }
  console.log("DONE");
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
