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
import { open, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClickHouseClient } from "@clickhouse/client";

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

export async function replayGooseMigrationUp({
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

  const queries = statements.map((statement) =>
    // `${VAR}` and `${VAR:-fallback}`, the two forms goose's envsub accepts.
    // An unmodelled variable still throws rather than reaching ClickHouse:
    // its fallback is only correct when goose would have left it unset, and
    // guessing that is how a replay quietly builds the wrong table.
    statement.replace(
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
    ),
  );

  await withReplayLock(database, async () => {
    for (const query of queries) {
      await client.command({ query });
    }
  });
}

/**
 * One replay at a time per database, across processes.
 *
 * A rebuild migration drops and recreates scratch tables (`..._rebuild`,
 * `..._recon`) under fixed names, so two replays running at once corrupt each
 * other: one's DROP lands between the other's CREATE and its INSERT, and the
 * loser reports either "table already exists" or "table does not exist" from a
 * migration whose own statements are perfectly ordered.
 *
 * Two files replaying at once is not hypothetical and is not a worker-count
 * setting. Vitest starts the next file's fork before the previous file has
 * finished, so an `afterAll` that replays overlaps the next file's `beforeAll`
 * that replays, with `fileParallelism: false` and one worker. Only a lock
 * outside both processes can order them, and this helper is the single door
 * every replay goes through.
 */
const LOCK_POLL_MS = 50;
/**
 * Below the 120s hook timeout of the suites that replay, so a lock nobody ever
 * releases fails with a message naming the file to delete rather than as a
 * generic hook timeout.
 */
const LOCK_WAIT_TIMEOUT_MS = 90_000;
/**
 * A holder that has had it this long is a corpse, and breaking the lock beats
 * failing the run. Two orders of magnitude above a real hold: replaying the
 * rollup rebuild takes about 200ms. Has to stay well under the wait timeout
 * too, or the waiter gives up before it is ever allowed to break anything.
 */
const LOCK_STALE_MS = 30_000;

async function withReplayLock<T>(
  database: string,
  run: () => Promise<T>,
): Promise<T> {
  const lockPath = join(
    tmpdir(),
    `langwatch-migration-replay-${database}.lock`,
  );
  await acquireLock(lockPath);
  try {
    return await run();
  } finally {
    await rm(lockPath, { force: true });
  }
}

/** Exclusive-create as the primitive: `wx` fails rather than truncates. */
async function tryTakeLock(lockPath: string): Promise<boolean> {
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(lockPath, "wx");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
  try {
    await handle.writeFile(`${process.pid}`);
  } finally {
    await handle.close();
  }
  return true;
}

/** How long the current holder has had it, or 0 once it has let go. */
async function lockHeldForMs(lockPath: string): Promise<number> {
  return stat(lockPath)
    .then((entry) => Date.now() - entry.mtimeMs)
    .catch(() => 0);
}

async function acquireLock(lockPath: string): Promise<void> {
  const deadline = Date.now() + LOCK_WAIT_TIMEOUT_MS;

  while (!(await tryTakeLock(lockPath))) {
    // A crashed holder must not wedge every later suite, so a lock older than
    // any replay could legitimately take is broken rather than waited on.
    if ((await lockHeldForMs(lockPath)) > LOCK_STALE_MS) {
      await rm(lockPath, { force: true });
      continue;
    }
    if (Date.now() > deadline) {
      throw new Error(
        `timed out waiting for the migration replay lock at ${lockPath}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_MS));
  }
}
