/**
 * Regenerates `columnsManifest.generated.json`, the checked-in dump of every
 * ClickHouse table's columns after the shipped migrations have been applied.
 *
 * ── WHY THIS SCRIPT EXISTS ─────────────────────────────────────────────────
 * The derived-dataset builder (`catalog/defineDatasetFromTable.ts`) takes each
 * exposed column's exact ClickHouse type from a manifest rather than restating
 * it by hand. The database is authoritative for those types, so the manifest is
 * generated from it, never edited: this script runs the shipped migrations into
 * a throwaway ClickHouse — the same `migrateUp` runner the lwql integration
 * harness uses under `facts: "migrated"` — dumps `system.columns` and
 * `system.tables`, and writes the JSON.
 *
 * It starts the container directly rather than importing the integration
 * harness: that harness imports `vitest`, which a plain script cannot load. The
 * parity integration test drives the harness proper, so any drift between this
 * container's schema and the harness's is caught there.
 *
 * A parity integration test regenerates the same dump and fails if the
 * committed file has drifted, so a migration that changes a column is a red test
 * until the manifest is regenerated here.
 *
 * Run:  pnpm generate:lwql-columns-manifest
 * Needs: a container runtime (testcontainers ClickHouse) and the `goose` binary.
 *
 * @see ../src/server/analytics/lwql/catalog/columnsManifest.ts
 * @see ../src/server/analytics/lwql/catalog/__tests__/columnsManifestParity.integration.test.ts
 */

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createClient } from "@clickhouse/client";
import { ClickHouseContainer } from "@testcontainers/clickhouse";

import { buildColumnsManifestFromDatabase } from "../src/server/analytics/lwql/catalog/columnsManifest";
import { migrateUp } from "../src/server/clickhouse/goose";

/**
 * The ClickHouse image the integration harness pins
 * (`lwqlClickHouseHarness.ts#TEST_CLICKHOUSE_IMAGE`). Kept in step by the parity
 * test, which dumps through the harness itself.
 */
const CLICKHOUSE_IMAGE = "clickhouse/clickhouse-server:25.10.2.65";
const MANIFEST_DATABASE = "lwql_manifest";
const ADMIN_USER = "manifest";
const ADMIN_PASSWORD = "manifest";

const OUTPUT_PATH = fileURLToPath(
  new URL(
    "../src/server/analytics/lwql/catalog/columnsManifest.generated.json",
    import.meta.url,
  ),
);

async function main(): Promise<void> {
  const container = await new ClickHouseContainer(CLICKHOUSE_IMAGE)
    .withUsername(ADMIN_USER)
    .withPassword(ADMIN_PASSWORD)
    .withStartupTimeout(120_000)
    .start();

  // CLICKHOUSE_CLUSTER is a deployment fact that switches every engine to its
  // Replicated form, which needs a Keeper the container has not got. Unset it
  // for the migration run, exactly as runShippedMigrations does.
  const previousCluster = process.env.CLICKHOUSE_CLUSTER;
  delete process.env.CLICKHOUSE_CLUSTER;

  const client = createClient({
    url: container.getHttpUrl(),
    username: ADMIN_USER,
    password: ADMIN_PASSWORD,
  });

  try {
    await migrateUp({
      connectionUrl: container.getConnectionUrl(),
      database: MANIFEST_DATABASE,
    });
    const manifest = await buildColumnsManifestFromDatabase({
      client,
      database: MANIFEST_DATABASE,
    });
    writeFileSync(OUTPUT_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`wrote ${manifest.tables.length} tables to ${OUTPUT_PATH}`);
  } finally {
    if (previousCluster !== undefined) {
      process.env.CLICKHOUSE_CLUSTER = previousCluster;
    }
    await client.close();
    await container.stop();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
