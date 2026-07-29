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

  for (const statement of statements) {
    const sql = statement
      .replaceAll("${CLICKHOUSE_DATABASE}", database)
      .replaceAll("${CLICKHOUSE_STORAGE_POLICY_SETTING}", storagePolicySetting);

    const unsubstituted = sql.match(/\$\{[^}]+\}/);
    if (unsubstituted) {
      throw new Error(
        `migration ${fileName} uses ${unsubstituted[0]} which this replay helper does not substitute`,
      );
    }

    await client.command({ query: sql });
  }
}
