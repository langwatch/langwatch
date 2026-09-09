/**
 * Replays one goose ClickHouse migration's Up section, for a suite staging a
 * pre-upgrade schema the goose runner cannot reach. An unrecognised `${...}`
 * throws: guessing a fallback quietly builds the wrong table.
 */
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { ClickHouseClient } from "@clickhouse/client";

/**
 * The shipped migration files, resolved through the package that owns them
 * rather than by walking the workspace: the entry point is `src/index.ts`, and
 * `migrations/` sits beside `src/`.
 */
const migrationsDirectory = join(
  dirname(createRequire(import.meta.url).resolve("@langwatch/clickhouse-client")),
  "..",
  "migrations",
);

/**
 * In order, what brings `gateway_budget_scope_totals` back to the shape the
 * reader speaks. Append whenever another lands: replaying only some of it
 * hands the reader a rollup it cannot read.
 */
export const CURRENT_ROLLUP_REBUILD_MIGRATIONS = [
  "00069_gateway_budget_scope_totals_budget_grain.sql",
  "00070_gateway_budget_ledger_nano_usd.sql",
  "00082_gateway_budget_scope_totals_exclude_pulled.sql",
  "00088_aggregating_rollup_dimension_columns.sql",
] as const;

/** Replays `CURRENT_ROLLUP_REBUILD_MIGRATIONS` in order. */
export async function replayRollupRebuild(client: ClickHouseClient): Promise<void> {
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
  const raw = await readFile(join(migrationsDirectory, fileName), "utf-8");

  // Only the Up section: the Down section keeps its own (commented-out)
  // statement blocks, which must never run here.
  const upSection = raw.split("-- +goose Down")[0]!;
  const statements = [
    ...upSection.matchAll(/-- \+goose StatementBegin\r?\n([\s\S]*?)-- \+goose StatementEnd/g),
  ]
    .map((match) => match[1]!.trim())
    .filter((statement) => statement.length > 0);
  if (statements.length === 0) {
    throw new Error(`no Up statements found in migration ${fileName}`);
  }

  const variables = await resolveMigrationVariables(client);
  for (const statement of statements) {
    await client.command({ query: substitute({ statement, variables, fileName }) });
  }
}

/** The variables goose's own bootstrap resolves, read off the live server. */
async function resolveMigrationVariables(
  client: ClickHouseClient,
): Promise<Record<string, string>> {
  const [databaseRow] = await client
    .query({ query: "SELECT currentDatabase() AS db", format: "JSONEachRow" })
    .then((result) => result.json<{ db: string }>());
  const database = databaseRow?.db;
  if (!database) throw new Error("could not resolve current ClickHouse database");

  const policies = await client
    .query({
      query: "SELECT policy_name FROM system.storage_policies WHERE policy_name = 'local_primary'",
      format: "JSONEachRow",
    })
    .then((result) => result.json());
  const cluster = process.env.CLICKHOUSE_CLUSTER || undefined;

  return {
    CLICKHOUSE_DATABASE: database,
    CLICKHOUSE_STORAGE_POLICY_SETTING:
      policies.length > 0 ? ", storage_policy = 'local_primary'" : "",
    CLICKHOUSE_ENGINE_MERGETREE: cluster ? "ReplicatedMergeTree()" : "MergeTree()",
    CLICKHOUSE_ENGINE_REPLACING_PREFIX: cluster
      ? "ReplicatedReplacingMergeTree("
      : "ReplacingMergeTree(",
    CLICKHOUSE_ENGINE_AGGREGATING: cluster
      ? "ReplicatedAggregatingMergeTree()"
      : "AggregatingMergeTree()",
  };
}

/** `${VAR}` and `${VAR:-fallback}`, the two forms goose's envsub accepts. */
function substitute({
  statement,
  variables,
  fileName,
}: {
  statement: string;
  variables: Record<string, string>;
  fileName: string;
}): string {
  return statement.replace(
    /\$\{([A-Z_]+)(?::-([^}]*))?\}/g,
    (_whole, name: string, fallback: string | undefined) => {
      const value = variables[name];
      if (value !== undefined) return value;
      throw new Error(
        `migration ${fileName} uses \${${name}${
          fallback === undefined ? "" : `:-${fallback}`
        }} which this replay helper does not substitute`,
      );
    },
  );
}
