/**
 * Regenerates `lwql-columns-manifest.generated.json`, the checked-in dump of every ClickHouse
 * table's columns after the shipped migrations have run.
 */

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { migrateUp } from "@langwatch/clickhouse-migrations";
import { ClickHouseContainer } from "@testcontainers/clickhouse";

import type {
  ColumnsManifest,
  ColumnsManifestColumn,
} from "../src/rules/lwql-columns-manifest.rules.ts";

/** The image the integration harness pins, kept in step by the parity test. */
const CLICKHOUSE_IMAGE = "clickhouse/clickhouse-server:25.10.2.65";
const MANIFEST_DATABASE = "lwql_manifest";
const ADMIN_USER = "manifest";
const ADMIN_PASSWORD = "manifest";

const OUTPUT_PATH = fileURLToPath(
  new URL("../src/rules/lwql-columns-manifest.generated.json", import.meta.url),
);

interface DumpServer {
  httpUrl: string;
  connectionUrl: string;
  username: string;
  password: string;
  stop: () => Promise<void>;
}

/**
 * Where the migrations run so their output can be read back: a container by
 * default, and the server `LANGWATCH_TEST_CLICKHOUSE_URL` names when it is set.
 */
async function clickHouseForDump(): Promise<DumpServer> {
  const existing = process.env.LANGWATCH_TEST_CLICKHOUSE_URL;
  if (existing) {
    const url = new URL(existing);
    const username = decodeURIComponent(url.username) || "default";
    const password = decodeURIComponent(url.password);

    return {
      httpUrl: `${url.protocol}//${url.host}`,
      // Re-encoded on the way back into a URL: the decoded pair is what the
      // client wants, but a password holding @ : / or # would split this string
      // at the wrong place and point goose at another host.
      connectionUrl: `${url.protocol}//${encodeURIComponent(username)}:${encodeURIComponent(password)}@${url.host}/${MANIFEST_DATABASE}`,
      username,
      password,
      stop: async () => {
        // The server is not ours to stop.
      },
    };
  }

  const container = await new ClickHouseContainer(CLICKHOUSE_IMAGE)
    .withUsername(ADMIN_USER)
    .withPassword(ADMIN_PASSWORD)
    .withStartupTimeout(120_000)
    .start();

  return {
    httpUrl: container.getHttpUrl(),
    connectionUrl: container.getConnectionUrl(),
    username: ADMIN_USER,
    password: ADMIN_PASSWORD,
    stop: async () => {
      await container.stop();
    },
  };
}

/** The manifest as one dump of a live database. */
async function buildColumnsManifest({
  client,
  database,
}: {
  client: ClickHouseClient;
  database: string;
}): Promise<ColumnsManifest> {
  const tableRows = await client
    .query({
      query:
        "SELECT name, engine, sorting_key AS sortingKey FROM system.tables " +
        "WHERE database = {database:String} AND name NOT LIKE '.%' ORDER BY name",
      query_params: { database },
      format: "JSONEachRow",
    })
    .then((result) => result.json<{ name: string; engine: string; sortingKey: string }>());

  const columnRows = await client
    .query({
      query:
        "SELECT table, name, type, comment FROM system.columns " +
        "WHERE database = {database:String} AND table NOT LIKE '.%' " +
        "ORDER BY table, position",
      query_params: { database },
      format: "JSONEachRow",
    })
    .then((result) =>
      result.json<{ table: string; name: string; type: string; comment: string }>(),
    );

  const columnsByTable = new Map<string, ColumnsManifestColumn[]>();
  for (const row of columnRows) {
    const list = columnsByTable.get(row.table) ?? [];
    list.push({ name: row.name, type: row.type, comment: row.comment });
    columnsByTable.set(row.table, list);
  }

  return {
    tables: tableRows.map((table) => ({
      name: table.name,
      engine: table.engine,
      sortingKey: table.sortingKey,
      columns: columnsByTable.get(table.name) ?? [],
    })),
  };
}

async function main(): Promise<void> {
  const server = await clickHouseForDump();
  // CLICKHOUSE_CLUSTER switches every engine to its Replicated form, which needs
  // a Keeper the container has not got.
  const previousCluster = process.env.CLICKHOUSE_CLUSTER;
  delete process.env.CLICKHOUSE_CLUSTER;
  const client = createClient({
    url: server.httpUrl,
    username: server.username,
    password: server.password,
  });

  try {
    // Dropped first, so a reused server dumps this run's migrations rather than
    // whatever a previous run left in the scratch database.
    await client.command({ query: `DROP DATABASE IF EXISTS ${MANIFEST_DATABASE}` });
    await migrateUp({
      connectionUrl: server.connectionUrl,
      database: MANIFEST_DATABASE,
      childEnvironment: process.env,
    });
    const manifest = await buildColumnsManifest({ client, database: MANIFEST_DATABASE });
    writeFileSync(OUTPUT_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`wrote ${manifest.tables.length} tables to ${OUTPUT_PATH}`);
  } finally {
    if (previousCluster !== undefined) {
      process.env.CLICKHOUSE_CLUSTER = previousCluster;
    }

    await client.close();
    await server.stop();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
