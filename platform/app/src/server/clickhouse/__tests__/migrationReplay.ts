/**
 * Replays a single goose ClickHouse migration file against a live client.
 *
 * Integration tests that cover an upgrade path need to place the schema in
 * the state an earlier migration left it in, write data there, and then
 * apply a later migration to that data. The goose runner cannot do this
 * (it only moves the whole version table forward), so this helper executes
 * the Up section of one migration file directly: it splits the file on the
 * goose statement markers and substitutes the same environment variables
 * goose's runner injects (see buildMigrationEnvVars in ../goose.ts).
 *
 * Only the variables the replayed migrations use are supported; an
 * unrecognised `${...}` placeholder throws instead of reaching ClickHouse.
 */
import { closeSync, openSync, statSync, unlinkSync, writeSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClickHouseClient } from "@clickhouse/client";
import { afterAll, beforeAll } from "vitest";

const MIGRATIONS_DIR = join(__dirname, "..", "migrations");

/**
 * The newest migration that rebuilds `gateway_budget_scope_totals` from the
 * ledger.
 *
 * Tests that replay an older rollup migration to stage a pre-upgrade state
 * must replay this one to come back, not the one that happened to be
 * current when they were written: every rebuild both re-derives the rows
 * and re-declares the sorting key, so restoring an older one hands later
 * suites a rollup at a grain the reader no longer speaks. Point this at the
 * newest rebuild whenever one lands.
 */
export const CURRENT_ROLLUP_REBUILD_MIGRATION =
  "00069_gateway_budget_scope_totals_budget_grain.sql";

/**
 * One lock for the run. The schema these replays mutate belongs to the single
 * test database every integration file connects to, so there is nothing finer
 * to key it by, and only the handful of suites below ever take it.
 */
const SCHEMA_LOCK_PATH = join(tmpdir(), "langwatch-clickhouse-schema.lock");

/** Longer than any replay, short enough that a killed run frees it quickly. */
const SCHEMA_LOCK_STALE_MS = 120_000;
const SCHEMA_LOCK_TIMEOUT_MS = 60_000;

let lockDepth = 0;

/**
 * Serialises everything that mutates, or reads through, the shared ClickHouse
 * schema.
 *
 * A rollup rebuild is not tenant-scoped, so a per-run tenant id isolates
 * nothing from it. It drops `gateway_budget_scope_totals_mv`, re-derives the
 * rollup from the ledger, swaps the table in and recreates the view, and its
 * closing reconciliation reads the rollup before writing a delta back. Two
 * things break when a second suite runs alongside that:
 *
 *   - A debit inserted while the view is missing reaches the ledger and never
 *     reaches the rollup, so every window the other suite reads comes back at
 *     zero, including TOTAL, which does no period arithmetic at all. The
 *     reconciliation repairs the rollup a moment later, which is why a rerun
 *     always passes.
 *   - Two replays interleave. Both build `gateway_budget_scope_totals_rebuild`
 *     and `..._recon` under fixed names, so the loser reports a table that
 *     already exists or has just vanished, and both can read the same
 *     pre-delta rollup and each add the full delta, doubling every total.
 *
 * The lock is a file created with the exclusive flag, so the filesystem picks
 * the winner rather than anything in the process. It is re-entrant within a
 * process: a suite that holds it for its whole run still replays migrations
 * inside its own tests.
 */
export async function acquireClickHouseSchemaLock(): Promise<() => void> {
  if (lockDepth > 0) {
    lockDepth++;
    return releaseOnce();
  }

  const deadline = Date.now() + SCHEMA_LOCK_TIMEOUT_MS;
  for (;;) {
    try {
      const handle = openSync(SCHEMA_LOCK_PATH, "wx");
      writeSync(handle, `${process.pid} ${new Date().toISOString()}\n`);
      closeSync(handle);
      lockDepth = 1;
      return releaseOnce();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      dropStaleLock();
      if (Date.now() > deadline) {
        throw new Error(
          `timed out after ${SCHEMA_LOCK_TIMEOUT_MS}ms waiting for the ClickHouse schema lock at ${SCHEMA_LOCK_PATH}`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
}

/**
 * Holds the schema lock for a whole test file.
 *
 * Call it as the first statement of the file's outermost `describe`, before
 * the file registers any hook of its own: vitest runs `beforeAll` in
 * definition order and `afterAll` in reverse, so the lock is taken before the
 * first fixture writes anything and released after the last teardown. Any
 * suite that writes the budget ledger and reads the rollup needs this, not
 * only the ones that replay a migration, because the damage lands on the
 * neighbour rather than on the replay.
 */
export function holdClickHouseSchemaLockForFile(): void {
  let release: (() => void) | undefined;

  beforeAll(async () => {
    release = await acquireClickHouseSchemaLock();
  }, 120_000);

  afterAll(() => {
    release?.();
  });
}

function releaseOnce(): () => void {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    lockDepth = Math.max(0, lockDepth - 1);
    if (lockDepth === 0) removeLockFile();
  };
}

function removeLockFile(): void {
  try {
    unlinkSync(SCHEMA_LOCK_PATH);
  } catch {
    // Already gone: a stale-lock break or a crashed holder got there first.
  }
}

function dropStaleLock(): void {
  try {
    const heldForMs = Date.now() - statSync(SCHEMA_LOCK_PATH).mtimeMs;
    if (heldForMs > SCHEMA_LOCK_STALE_MS) removeLockFile();
  } catch {
    // The holder released it between the two calls, which is the good case.
  }
}

// A worker killed mid-replay would otherwise leave the lock standing for the
// whole stale window.
process.on("exit", () => {
  if (lockDepth > 0) removeLockFile();
});

export async function replayGooseMigrationUp({
  client,
  fileName,
}: {
  client: ClickHouseClient;
  fileName: string;
}): Promise<void> {
  const release = await acquireClickHouseSchemaLock();
  try {
    await runMigrationStatements({ client, fileName });
  } finally {
    release();
  }
}

async function runMigrationStatements({
  client,
  fileName,
}: {
  client: ClickHouseClient;
  fileName: string;
}): Promise<void> {
  const raw = await readFile(join(MIGRATIONS_DIR, fileName), "utf-8");

  // Only the Up section: the Down section keeps its own (commented-out)
  // statement blocks which must never run here.
  const upSection = raw.split("-- +goose Down")[0]!;

  const statements = [
    ...upSection.matchAll(
      /-- \+goose StatementBegin\r?\n([\s\S]*?)-- \+goose StatementEnd/g,
    ),
  ]
    .map((match) => match[1]!.trim())
    .filter((statement) => statement.length > 0);

  if (statements.length === 0) {
    throw new Error(`no Up statements found in migration ${fileName}`);
  }

  // The database goose targets is the one the client is connected to.
  const [dbRow] = await client
    .query({ query: "SELECT currentDatabase() AS db", format: "JSONEachRow" })
    .then((result) => result.json<{ db: string }>());
  const database = dbRow?.db;
  if (!database) {
    throw new Error("could not resolve current ClickHouse database");
  }

  // Mirror the storage-policy probe goose's bootstrap performs: production
  // ClickHouse has 'local_primary', bare local instances do not.
  const policyRows = await client
    .query({
      query:
        "SELECT policy_name FROM system.storage_policies WHERE policy_name = 'local_primary'",
      format: "JSONEachRow",
    })
    .then((result) => result.json());
  const storagePolicySetting =
    policyRows.length > 0 ? ", storage_policy = 'local_primary'" : "";

  // The engine substitutions, resolved from CLICKHOUSE_CLUSTER exactly as
  // buildMigrationEnvVars does. A migration that declares its engine through
  // these placeholders is the norm rather than the exception now, so a
  // replay that could not resolve them would silently limit which
  // migrations are replayable.
  const cluster = process.env.CLICKHOUSE_CLUSTER || undefined;
  const vars: Record<string, string> = {
    CLICKHOUSE_DATABASE: database,
    CLICKHOUSE_STORAGE_POLICY_SETTING: storagePolicySetting,
    CLICKHOUSE_ENGINE_MERGETREE: cluster
      ? "ReplicatedMergeTree()"
      : "MergeTree()",
    CLICKHOUSE_ENGINE_REPLACING_PREFIX: cluster
      ? "ReplicatedReplacingMergeTree("
      : "ReplacingMergeTree(",
    CLICKHOUSE_ENGINE_AGGREGATING: cluster
      ? "ReplicatedAggregatingMergeTree()"
      : "AggregatingMergeTree()",
  };

  for (const statement of statements) {
    // `${VAR}` and `${VAR:-fallback}`, the two forms goose's envsub accepts.
    // An unmodelled variable still throws rather than reaching ClickHouse:
    // its fallback is only correct when goose would have left it unset, and
    // guessing that is how a replay quietly builds the wrong table.
    const sql = statement.replace(
      /\$\{([A-Z_]+)(?::-([^}]*))?\}/g,
      (_whole, name: string, fallback: string | undefined) => {
        const value = vars[name];
        if (value !== undefined) return value;
        throw new Error(
          `migration ${fileName} uses \${${name}${
            fallback === undefined ? "" : `:-${fallback}`
          }} which this replay helper does not substitute`,
        );
      },
    );

    await client.command({ query: sql });
  }
}
