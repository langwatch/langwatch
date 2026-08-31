/**
 * Runs BEFORE `prisma migrate deploy` (wired into the `prisma:migrate`
 * package.json script), so every caller of that script — the Docker boot
 * path, the embedded server's migrate service, CI — gets it for free.
 *
 * Why it exists: some indexes are too expensive to build with a plain
 * CREATE INDEX on a live installation. Prisma wraps each migration in a
 * transaction, and CREATE INDEX CONCURRENTLY refuses to run inside one, so
 * the migration file itself can only ever do the blocking build. This
 * script is the nontransactional half of that pair: on an installation
 * that already has data, it builds the index CONCURRENTLY (writes keep
 * flowing) before the migration runs, and the migration's IF NOT EXISTS
 * then no-ops. On a fresh install the target table does not exist yet, the
 * script skips, and the blocking build inside the migration is instant
 * because the table is empty.
 *
 * Failure is loud on purpose. If the concurrent build fails on a populated
 * installation, the script drops the invalid leftover index (a failed
 * CREATE INDEX CONCURRENTLY leaves one behind, and IF NOT EXISTS would
 * silently match it) and exits non-zero, which stops `migrate deploy` from
 * running the blocking build as a surprise fallback. What it never does is
 * hide a failure and let the deployment take a lock nobody planned for.
 *
 * Plain .mjs on plain `node`, because the production image prunes
 * devDependencies and tsx is one. `pg` is a runtime dependency.
 */
import pg from "pg";

/**
 * One entry per index that must never be built with a blocking CREATE INDEX
 * on a populated installation. `migration` is the Prisma migration that
 * carries the IF NOT EXISTS fallback; once it is recorded as applied there
 * is nothing left to prebuild.
 */
export const CONCURRENT_PREBUILDS = [
  {
    migration: "20260831120000_grant_role_key_live_index",
    table: "Grant",
    index: "Grant_organizationId_roleKey_live_idx",
    build: `CREATE INDEX CONCURRENTLY IF NOT EXISTS "Grant_organizationId_roleKey_live_idx"
  ON "Grant" ("organizationId", "roleKey")
  WHERE "revokedAt" IS NULL`,
  },
];

/**
 * Serializes replicas booting at once. Without this, pod B's IF NOT EXISTS
 * matches pod A's still-building (invalid) index, skips, and B's
 * `migrate deploy` records the migration while the index is not yet usable.
 * Session-level (not xact) because CONCURRENTLY runs outside transactions;
 * released on disconnect.
 */
const ADVISORY_LOCK_SQL =
  "SELECT pg_advisory_lock(hashtext('prisma-premigrate'))";

/** @returns {"skip-fresh-install"|"skip-applied"|"skip-prebuilt"|"built"} */
export async function prebuildOne(client, spec) {
  const table = await client.query("SELECT to_regclass($1) AS t", [
    `"${spec.table}"`,
  ]);
  if (table.rows[0].t === null) return "skip-fresh-install";

  const migrations = await client.query(
    "SELECT to_regclass('_prisma_migrations') AS t",
  );
  if (migrations.rows[0].t !== null) {
    const applied = await client.query(
      "SELECT 1 FROM _prisma_migrations WHERE migration_name = $1 AND finished_at IS NOT NULL",
      [spec.migration],
    );
    if (applied.rowCount > 0) return "skip-applied";
  }

  const existing = await client.query(
    `SELECT i.indisvalid AS valid
       FROM pg_class c
       JOIN pg_index i ON i.indexrelid = c.oid
      WHERE c.relname = $1`,
    [spec.index],
  );
  if (existing.rowCount > 0) {
    if (existing.rows[0].valid) return "skip-prebuilt";
    // Leftover from a failed concurrent build (possibly a previous run of
    // this very script). Invalid indexes are never used by the planner but
    // WOULD satisfy IF NOT EXISTS — drop before rebuilding. The drop is a
    // catalog unlink, sub-millisecond.
    await client.query(`DROP INDEX IF EXISTS "${spec.index}"`);
  }

  try {
    await client.query(spec.build);
  } catch (err) {
    await client
      .query(`DROP INDEX IF EXISTS "${spec.index}"`)
      .catch(() => undefined);
    throw err;
  }

  const verify = await client.query(
    `SELECT i.indisvalid AS valid
       FROM pg_class c
       JOIN pg_index i ON i.indexrelid = c.oid
      WHERE c.relname = $1`,
    [spec.index],
  );
  if (verify.rowCount === 0 || !verify.rows[0].valid) {
    await client
      .query(`DROP INDEX IF EXISTS "${spec.index}"`)
      .catch(() => undefined);
    throw new Error(
      `concurrent build of "${spec.index}" finished but the index is not valid`,
    );
  }
  return "built";
}

/**
 * Prisma reads the `schema` query param of DATABASE_URL and sets
 * search_path from it; node-postgres ignores it. Mirror Prisma so
 * to_regclass and _prisma_migrations resolve in the same schema the
 * migrations run in.
 */
export function schemaFromUrl(databaseUrl) {
  try {
    return new URL(databaseUrl).searchParams.get("schema");
  } catch {
    return null;
  }
}

export async function run(databaseUrl, log = console.error) {
  if (!databaseUrl) {
    log("[premigrate] DATABASE_URL not set — skipping (migrate deploy will report it)");
    return;
  }
  const client = new pg.Client({ connectionString: databaseUrl });
  try {
    await client.connect();
  } catch (err) {
    // Unreachable database is migrate deploy's error to raise, with its own
    // wording — this script only steps in when a prebuild is possible.
    log(`[premigrate] cannot connect — skipping (${err.message})`);
    return;
  }
  try {
    const schema = schemaFromUrl(databaseUrl);
    if (schema) {
      await client.query(`SET search_path TO "${schema}", public`);
    }
    await client.query(ADVISORY_LOCK_SQL);
    for (const spec of CONCURRENT_PREBUILDS) {
      const started = Date.now();
      const outcome = await prebuildOne(client, spec);
      log(
        `[premigrate] ${spec.index}: ${outcome}${
          outcome === "built" ? ` in ${Date.now() - started}ms` : ""
        }`,
      );
    }
  } finally {
    await client.end().catch(() => undefined);
  }
}

const invokedDirectly =
  process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (invokedDirectly) {
  run(process.env.DATABASE_URL).catch((err) => {
    console.error(`[premigrate] FAILED: ${err.message}`);
    console.error(
      "[premigrate] refusing to fall through to a blocking CREATE INDEX — fix the error above and redeploy",
    );
    process.exit(1);
  });
}
