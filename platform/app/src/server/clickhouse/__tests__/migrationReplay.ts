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
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ClickHouseClient } from "@clickhouse/client";

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
 * the nano-USD aggregate every spend read now sums. Append to this list
 * whenever another lands.
 */
export const CURRENT_ROLLUP_REBUILD_MIGRATIONS = [
  "00069_gateway_budget_scope_totals_budget_grain.sql",
  "00070_gateway_budget_ledger_nano_usd.sql",
] as const;

/** Replays `CURRENT_ROLLUP_REBUILD_MIGRATIONS` in order. */
export async function replayRollupRebuild(
  client: ClickHouseClient,
): Promise<void> {
  for (const fileName of CURRENT_ROLLUP_REBUILD_MIGRATIONS) {
    await replayGooseMigrationUp({ client, fileName });
  }
}

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
