/**
 * @vitest-environment node
 * @integration
 * Reads the real server: the refusal's two queries, and its placement before the version row the
 * bootstrap inserts next, which would otherwise put the count above zero.
 * Spec: specs/clickhouse/replicated-migration-versions.feature.
 */
import { type ClickHouseClient, createClient } from "@clickhouse/client";
import { DEFAULT_CLICKHOUSE_SETTINGS } from "@langwatch/clickhouse-client";
import { startTestClickHouseEndpoints } from "@langwatch/clickhouse-client/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runMigrations } from "../goose.migration-runner.ts";

/** The table a restore leaves behind, named so no migration of ours ever claims it. */
const RESTORED_TABLE = "restored_customer_rows";

describe("given a ClickHouse database restored without its goose version history", () => {
  let client: ClickHouseClient;
  let database: string;
  let url: string;

  beforeAll(async () => {
    const [provisioned] = await startTestClickHouseEndpoints({
      suite: "clickhouse-migrations-unversioned",
      names: ["restored"],
      environment: process.env,
    });
    if (!provisioned)
      throw new Error("No ClickHouse endpoint was provisioned for the restored suite");

    // A database of its own, never migrated, so the refusal reads the counts a restore leaves.
    database = `${provisioned.database}_restored`;
    const parsed = new URL(provisioned.url);
    parsed.pathname = `/${database}`;
    url = parsed.toString();

    client = createClient({
      url: provisioned.url,
      clickhouse_settings: DEFAULT_CLICKHOUSE_SETTINGS,
    });
    await client.command({ query: `DROP DATABASE IF EXISTS ${database}` });
    await client.command({ query: `CREATE DATABASE ${database}` });
    await client.command({
      query: `CREATE TABLE ${database}.${RESTORED_TABLE} (id String, at DateTime)
              ENGINE = MergeTree() ORDER BY id`,
    });
  }, 180_000);

  afterAll(async () => {
    await client?.command({ query: `DROP DATABASE IF EXISTS ${database}` }).catch(() => undefined);
    await client?.close();
  });

  describe("when the migration run is given that database", () => {
    /** @scenario "A real database restored without its version history refuses the run" */
    it("refuses the run, names the version history to restore, and leaves the table alone", async () => {
      await expect(runMigrations({ connectionUrl: url })).rejects.toThrow(
        /goose_db_version records no migration/,
      );

      const engines = await client.query({
        query: `SELECT engine FROM system.tables
                WHERE database = {database:String} AND name = {table:String}`,
        query_params: { database, table: RESTORED_TABLE },
        format: "JSONEachRow",
      });

      expect(await engines.json<{ engine: string }>()).toEqual([{ engine: "MergeTree" }]);
    }, 120_000);

    /** @scenario "A real database carrying a version row runs its migrations" */
    it("bootstraps and migrates once a version row is back", async () => {
      // Version 0 is goose's own starting row: history present, so every migration still applies.
      await client.command({
        query: `INSERT INTO ${database}.goose_db_version (version_id, is_applied) VALUES (0, 1)`,
      });

      await expect(runMigrations({ connectionUrl: url })).resolves.toBeUndefined();
    }, 300_000);
  });
});
