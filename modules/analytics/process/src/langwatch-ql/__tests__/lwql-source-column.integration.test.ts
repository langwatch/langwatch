/**
 * The `Source` column against a real ClickHouse: missing, empty and NULL origins count as
 * application, an unlisted origin as other, and a listed one as itself.
 * @see modules/dashboard/specs/dashboards-v2.feature AC200l, AC202e
 * @vitest-environment node
 */
import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { sourceOfOrigin } from "../../rules/lwql-source-column.rules.ts";

const url =
  process.env.LANGWATCH_TEST_CLICKHOUSE_URL ??
  process.env.TEST_CLICKHOUSE_URL ??
  process.env.CI_CLICKHOUSE_URL;
const DATABASE = `lwql_source_${process.pid}`;
let client: ClickHouseClient;

/** Counts the traces whose Source is in `sources`, bound as the statement binds it. */
async function counted(sources: string[]): Promise<number> {
  const result = await client.query({
    query: `SELECT count() AS n FROM ${DATABASE}.traces WHERE ${sourceOfOrigin("Origin")} IN {dashboard_context_sources:Array(String)}`,
    query_params: { dashboard_context_sources: sources },
    format: "JSONEachRow",
  });
  const [row] = await result.json<{ n: string }>();

  return Number(row?.n);
}

describe.skipIf(!url)("given traces of every kind of origin", () => {
  beforeAll(async () => {
    client = createClient({ url });
    await client.command({ query: `CREATE DATABASE IF NOT EXISTS ${DATABASE}` });
    await client.command({
      query: `CREATE TABLE ${DATABASE}.traces (Id UInt32, Origin Nullable(String)) ENGINE = Memory`,
    });
    await client.command({
      query: `INSERT INTO ${DATABASE}.traces VALUES (1, NULL), (2, ''), (3, 'application'), (4, 'mystery'), (5, 'langy'), (6, 'simulation'), (7, 'odd'), (8, 'gateway')`,
    });
  });

  afterAll(async () => {
    await client.command({ query: `DROP DATABASE IF EXISTS ${DATABASE}` });
    await client.close();
  });

  /** @scenario "AC202e Stock widgets: the Source column counts missing origins as application and unlisted ones as other" */
  it("counts missing, empty and application traces under application", async () => {
    expect(await counted(["application"])).toBe(3);
  });

  /** @scenario "AC202e Stock widgets: the Source column counts missing origins as application and unlisted ones as other" */
  it("counts only the unlisted origins under other", async () => {
    expect(await counted(["other"])).toBe(2);
  });

  /** @scenario "AC202e Stock widgets: the Source column counts missing origins as application and unlisted ones as other" */
  it("counts a listed origin under its own name only", async () => {
    expect(await counted(["langy"])).toBe(1);
    expect(await counted(["langy", "simulation"])).toBe(2);
    expect(await counted([])).toBe(0);
  });

  /** @scenario "AC200l Sources: other counts every origin outside the known ones" */
  it("keeps an empty list counting nothing and a full list counting every trace", async () => {
    expect(await counted(["application", "other", "langy", "simulation", "gateway"])).toBe(8);
  });
});
