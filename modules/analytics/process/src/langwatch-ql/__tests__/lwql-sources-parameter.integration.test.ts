/**
 * A statement is kept to its sources only where it reads {dashboard_context_sources}: against a
 * real ClickHouse, rows of other origins drop out through the trace lookup, a statement that does
 * not read the parameter counts everything, and a widget's own filter keeps its meaning.
 * @see modules/dashboard/specs/dashboards-v2.feature AC190, AC191, AC193, AC194
 * @vitest-environment node
 */
import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { sourceOfOrigin } from "../../rules/lwql-source-column.rules.ts";

const url = process.env.TEST_CLICKHOUSE_URL;
const DATABASE = `lwql_sources_${process.pid}`;
let client: ClickHouseClient;

/** The trace lookup a stock query reads a span view through. */
const BY_TRACE = `(TenantId, TraceId) IN (SELECT TenantId, TraceId FROM ${DATABASE}.trace_metrics WHERE ${sourceOfOrigin("Origin")} IN {dashboard_context_sources:Array(String)})`;

async function count(query: string, sources?: string[]): Promise<number> {
  const result = await client.query({
    query,
    ...(sources ? { query_params: { dashboard_context_sources: sources } } : {}),
    format: "JSONEachRow",
  });
  const [row] = await result.json<{ n: string }>();

  return Number(row?.n);
}

describe.skipIf(!url)("given traces of the application and of Langy, each with spans", () => {
  beforeAll(async () => {
    client = createClient({ url });
    await client.command({ query: `CREATE DATABASE IF NOT EXISTS ${DATABASE}` });
    await client.command({
      query: `CREATE TABLE ${DATABASE}.trace_metrics (TenantId String, TraceId String, Origin Nullable(String)) ENGINE = Memory`,
    });
    await client.command({
      query: `CREATE TABLE ${DATABASE}.spans (TenantId String, TraceId String) ENGINE = Memory`,
    });
    await client.command({
      query: `INSERT INTO ${DATABASE}.trace_metrics VALUES ('t', 'app1', NULL), ('t', 'app2', 'application'), ('t', 'chat1', 'langy'), ('t', 'chat2', 'langy'), ('t', 'sim1', 'simulation')`,
    });
    await client.command({
      query: `INSERT INTO ${DATABASE}.spans VALUES ('t', 'app1'), ('t', 'app1'), ('t', 'app2'), ('t', 'chat1'), ('t', 'chat1'), ('t', 'chat2'), ('t', 'sim1')`,
    });
  });

  afterAll(async () => {
    await client.command({ query: `DROP DATABASE IF EXISTS ${DATABASE}` });
    await client.close();
  });

  /** @scenario "AC190 Sources: a run whose sources leave langy out counts none of Langy's traces or their rows" */
  it("counts neither Langy's traces nor the spans that belong to them", async () => {
    const without = ["application", "simulation", "other"];

    const traces = await count(
      `SELECT count() AS n FROM ${DATABASE}.trace_metrics WHERE ${sourceOfOrigin("Origin")} IN {dashboard_context_sources:Array(String)}`,
      without,
    );
    const spans = await count(
      `SELECT count() AS n FROM ${DATABASE}.spans WHERE ${BY_TRACE}`,
      without,
    );

    expect(traces).toBe(3);
    expect(spans).toBe(4);
  });

  /** @scenario "AC193 Sources: a run whose sources hold every origin reads every trace, Langy's included" */
  it("reads every trace and span when the sources hold every origin", async () => {
    const every = ["application", "simulation", "langy", "other"];

    expect(await count(`SELECT count() AS n FROM ${DATABASE}.spans WHERE ${BY_TRACE}`, every)).toBe(
      7,
    );
  });

  /** @scenario "AC191 Langy: a widget's own origin filter keeps its meaning" */
  it("keeps a widget's own origin filter, whichever sources are bound", async () => {
    const own = `SELECT count() AS n FROM ${DATABASE}.trace_metrics WHERE Origin = 'application' AND ${sourceOfOrigin("Origin")} IN {dashboard_context_sources:Array(String)}`;

    expect(await count(own, ["application"])).toBe(1);
    expect(await count(own, ["application", "simulation", "other"])).toBe(1);
    expect(await count(own, ["langy"])).toBe(0);
  });

  /** @scenario "AC194 Langy: a query run outside a board is not scoped" */
  it("counts every origin when the statement does not read the parameter", async () => {
    expect(await count(`SELECT count() AS n FROM ${DATABASE}.trace_metrics`)).toBe(5);
    expect(await count(`SELECT count() AS n FROM ${DATABASE}.spans`)).toBe(7);
  });

  /** @scenario "AC202d Stock widgets: a widget whose list did not change returns the same rows" */
  it("returns the same rows for a list that holds the origins the statement already counted", async () => {
    const asWritten = await count(
      `SELECT count() AS n FROM ${DATABASE}.trace_metrics WHERE Origin IS NULL OR Origin IN ('application', 'simulation')`,
    );
    const sourced = await count(
      `SELECT count() AS n FROM ${DATABASE}.trace_metrics WHERE ${sourceOfOrigin("Origin")} IN {dashboard_context_sources:Array(String)}`,
      ["application", "simulation"],
    );

    expect(sourced).toBe(asWritten);
  });
});
