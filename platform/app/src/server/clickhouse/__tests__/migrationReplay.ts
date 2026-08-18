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
import { randomUUID } from "node:crypto";
import { link, open, readFile, rename, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClickHouseClient } from "@clickhouse/client";
import { acquireClickHouseSchemaLock } from "./schemaLock";

const MIGRATIONS_DIR = join(__dirname, "..", "migrations");

/**
 * Every migration that has to run, in order, to bring
 * `gateway_budget_scope_totals` back to the shape the reader speaks.
 *
 * Tests that replay an older rollup migration to stage a pre-upgrade state
 * must replay these to come back, not whichever one happened to be current
 * when they were written: each restates part of the rollup's shape, and
 * restoring only some of it hands later suites a rollup the reader cannot
 * read. 00069 re-derives the rows and declares the sorting key; 00070 adds
 * the nano-USD aggregate every spend read now sums; 00082 stops the view
 * folding pulled provider cost into those totals (ADR-088). Append to this
 * list whenever another lands.
 *
 * 00082 alters the view 00070 creates rather than creating its own, so it
 * only replays correctly after 00070 — which is the order this list is read
 * in, and the reason it is a list rather than a set.
 */
export const CURRENT_ROLLUP_REBUILD_MIGRATIONS = [
  "00069_gateway_budget_scope_totals_budget_grain.sql",
  "00070_gateway_budget_ledger_nano_usd.sql",
  "00082_gateway_budget_scope_totals_exclude_pulled.sql",
] as const;

/** Replays `CURRENT_ROLLUP_REBUILD_MIGRATIONS` in order. */
export async function replayRollupRebuild(
  client: ClickHouseClient,
): Promise<void> {
  for (const fileName of CURRENT_ROLLUP_REBUILD_MIGRATIONS) {
    await replayGooseMigrationUp({ client, fileName });
  }
}

/**
 * Called after each Up statement, with its zero-based index and text.
 *
 * A migration that swaps a live table has to survive writes that arrive
 * mid-run, and that is not something a test can provoke from outside: by the
 * time `replayGooseMigrationUp` returns, the window has closed. This hook is
 * the seam — a test writes into the table between the copy and the swap and
 * then asserts the row survived, which is the only way to cover a
 * reconciliation step rather than trust its comment.
 */
export type ReplayStatementHook = (step: {
  index: number;
  statement: string;
}) => Promise<void>;

export async function replayGooseMigrationUp({
  client,
  fileName,
  afterStatement,
}: {
  client: ClickHouseClient;
  fileName: string;
  afterStatement?: ReplayStatementHook;
}): Promise<void> {
  const release = await acquireClickHouseSchemaLock();
  try {
    await runMigrationStatements({ client, fileName, afterStatement });
  } finally {
    release();
  }
}

async function runMigrationStatements({
  client,
  fileName,
  afterStatement,
}: {
  client: ClickHouseClient;
  fileName: string;
  afterStatement?: ReplayStatementHook;
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

  await withReplayLock({
    database,
    run: async () => {
      for (const [index, query] of queries.entries()) {
        await client.command({ query });
        await afterStatement?.({ index, statement: query });
      }
    },
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

export async function withReplayLock<T>({
  database,
  run,
}: {
  database: string;
  run: () => Promise<T>;
}): Promise<T> {
  const lockPath = join(
    tmpdir(),
    `langwatch-migration-replay-${database}.lock`,
  );
  const owner = await acquireLock(lockPath);
  try {
    return await run();
  } finally {
    await releaseLock({ lockPath, owner });
  }
}

/**
 * Who holds the lock, unique per acquisition rather than per process.
 *
 * A pid alone cannot tell a holder from its replacement: the same process can
 * take the lock again after its first one was broken as stale, and pids are
 * reused across runs. Every removal below is guarded on this token, so a
 * holder only ever removes the lock it can prove is its own.
 */
const newOwnerToken = (): string => `${process.pid}-${randomUUID()}`;

/** Exclusive-create as the primitive: `wx` fails rather than truncates. */
async function tryTakeLock(lockPath: string, owner: string): Promise<boolean> {
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(lockPath, "wx");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
  try {
    await handle.writeFile(owner);
  } finally {
    await handle.close();
  }
  return true;
}

/**
 * Whether `error` is the refusal `link` gives when the destination already
 * exists. Anything that does not say so for itself, a value that is not an
 * object or one carrying a different code or none, is a real failure.
 *
 * Matched on shape rather than with `instanceof Error`, because the rejection
 * comes from a node builtin: under the vmThreads pool the suites run in, those
 * are constructed in the host realm and are not instances of this module's
 * `Error`.
 */
function isPathAlreadyTaken(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === "EEXIST"
  );
}

/** The token in the lock file, or null once it has gone. */
async function lockOwner(lockPath: string): Promise<string | null> {
  return readFile(lockPath, "utf-8").catch(() => null);
}

/** How long the current holder has had it, or 0 once it has let go. */
async function lockHeldForMs(lockPath: string): Promise<number> {
  return stat(lockPath)
    .then((entry) => Date.now() - entry.mtimeMs)
    .catch(() => 0);
}

/**
 * Removes the lock only while this holder still owns it.
 *
 * An unconditional remove would delete a replacement's lock: once this
 * holder's own lock has been broken as stale, whatever sits at the path
 * belongs to somebody else, and taking it away puts two replays inside the
 * critical section at once.
 */
async function releaseLock({
  lockPath,
  owner,
}: {
  lockPath: string;
  owner: string;
}): Promise<void> {
  await removeLockOwnedBy({ lockPath, expectedOwner: owner });
}

/**
 * Removes the lock file, but only while it still holds `expectedOwner`.
 * Answers whether it did.
 *
 * The rename is the atomic step: exactly one racer can move a given path, so
 * the winner is the only one that gets to decide what happens next. It can
 * still move a file that was replaced between the read and the rename, which
 * is why the token is re-checked afterwards and a stranger's lock is put back
 * through `link`, the only restore that refuses to overwrite whoever took the
 * path in the meantime.
 */
async function removeLockOwnedBy({
  lockPath,
  expectedOwner,
}: {
  lockPath: string;
  expectedOwner: string;
}): Promise<boolean> {
  const claimPath = `${lockPath}.claim-${randomUUID()}`;
  try {
    await rename(lockPath, claimPath);
  } catch {
    return false;
  }
  if ((await lockOwner(claimPath)) === expectedOwner) {
    await rm(claimPath, { force: true });
    return true;
  }
  // A live holder's lock, moved by a claim that was already out of date. It
  // goes back through `link`, which fails with EEXIST once somebody else has
  // taken the freed path, leaving that holder's lock where it is; `rename`
  // would replace it silently and put two replays inside the critical section
  // believing they each hold it. That EEXIST is the restore working, so it is
  // the only failure absorbed here: under any other one the lock was moved
  // away and never put back, and returning as if it had been lets a live
  // holder lose its lock silently. The claim copy goes either way: `link`
  // leaves its source in place.
  try {
    await link(claimPath, lockPath);
  } catch (error) {
    if (!isPathAlreadyTaken(error)) throw error;
  }
  await rm(claimPath, { force: true });
  return false;
}

async function acquireLock(lockPath: string): Promise<string> {
  const deadline = Date.now() + LOCK_WAIT_TIMEOUT_MS;
  const owner = newOwnerToken();

  while (!(await tryTakeLock(lockPath, owner))) {
    if (Date.now() > deadline) {
      throw new Error(
        `timed out waiting for the migration replay lock at ${lockPath}`,
      );
    }
    // A crashed holder must not wedge every later suite, so a lock older than
    // any replay could legitimately take is broken rather than waited on. The
    // break is bound to the holder that was measured: between the age check
    // and the removal the corpse can be replaced by a live holder, and
    // removing that one would put two replays inside the critical section.
    const observedOwner = await lockOwner(lockPath);
    if (
      observedOwner !== null &&
      (await lockHeldForMs(lockPath)) > LOCK_STALE_MS &&
      (await removeLockOwnedBy({ lockPath, expectedOwner: observedOwner }))
    ) {
      continue;
    }
    await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_MS));
  }
  return owner;
}
