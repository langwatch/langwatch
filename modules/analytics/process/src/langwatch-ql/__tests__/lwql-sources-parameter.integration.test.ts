/**
 * A statement is kept to its sources only where it reads {dashboard_context_sources}: against a
 * real ClickHouse, rows of other origins drop out through the trace lookup, a statement that does
 * not read the parameter counts everything, and a widget's own filter keeps its meaning.
 * @see modules/dashboard/specs/dashboards-v2.feature AC190, AC191, AC193, AC194, AC202g, AC202h
 * @vitest-environment node
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { TRACE_SOURCES } from "@langwatch/analytics-contract";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { sourceOfOrigin } from "../../rules/lwql-source-column.rules.ts";

const url =
  process.env.LANGWATCH_TEST_CLICKHOUSE_URL ??
  process.env.TEST_CLICKHOUSE_URL ??
  process.env.CI_CLICKHOUSE_URL;
const DATABASE = `lwql_sources_${process.pid}`;
let client: ClickHouseClient;

const STOCK_SQL = readFileSync(
  fileURLToPath(new URL("./fixtures/stock-widget-queries.json", import.meta.url)),
  "utf8",
);
const PERIOD = {
  dashboard_context_period_start: "2026-07-01 00:00:00",
  dashboard_context_period_end: "2026-07-08 00:00:00",
};

/** The lookup the catalogue stores for `view`, guard and bound included, over this database. */
function storedLookup(view: string): string {
  const lookup = `\\(${view}\\.TenantId, .*?, 1\\)\\)`;
  const stored = new RegExp(
    `(?:\\(has\\(\\{[^}]*\\}, 'application'\\) OR )?${lookup}(?:\\) AND ${lookup})?`,
  );

  const found = STOCK_SQL.match(stored)?.[0];
  if (!found)
    throw new Error(`no stored lookup for the "${view}" view in the stock widget fixture`);

  return found
    .replaceAll(`${view}.`, "")
    .replaceAll("FROM trace_metrics", `FROM ${DATABASE}.trace_metrics`)
    .replace(/\bSource\b/g, sourceOfOrigin("Origin"));
}

const BY_TRACE = storedLookup("spans");
const TRACES_BY_TRACE = storedLookup("traces");
const EVALUATION_BY_TRACE = storedLookup("evaluations");

async function count(query: string, sources?: string[]): Promise<number> {
  const result = await client.query({
    query,
    ...(sources ? { query_params: { dashboard_context_sources: sources, ...PERIOD } } : {}),
    format: "JSONEachRow",
  });
  const [row] = await result.json<{ n: string }>();

  return Number(row?.n);
}

/** Rows of `table` the lookup keeps, narrowed to one trace when named. */
function kept({
  table,
  lookup,
  sources,
  trace,
}: {
  table: string;
  lookup: string;
  sources: string[];
  trace?: string;
}): Promise<number> {
  const only = trace ? `TraceId = '${trace}' AND ` : "";

  return count(`SELECT count() AS n FROM ${DATABASE}.${table} WHERE ${only}${lookup}`, sources);
}

/** The spans kept of `mixed_spans`, where trace "none1" has no trace_metrics row. */
function mixedSpans(args: { sources: string[]; trace?: string }): Promise<number> {
  return kept({ table: "mixed_spans", lookup: BY_TRACE, ...args });
}

/** The evaluations kept of `evaluations`, whose TraceId is nullable as the view's is. */
function evaluations(args: { sources: string[]; trace?: string }): Promise<number> {
  return kept({ table: "evaluations", lookup: EVALUATION_BY_TRACE, ...args });
}

describe.skipIf(!url)("given traces of the application and of Langy, each with spans", () => {
  beforeAll(async () => {
    client = createClient({ url });
    await client.command({ query: `CREATE DATABASE IF NOT EXISTS ${DATABASE}` });
    await client.command({
      query: `CREATE TABLE ${DATABASE}.trace_metrics (TenantId String, TraceId String, Origin Nullable(String), OccurredAt DateTime DEFAULT '2026-07-05 00:00:00') ENGINE = Memory`,
    });
    await client.command({
      query: `CREATE TABLE ${DATABASE}.spans (TenantId String, TraceId String) ENGINE = Memory`,
    });
    await client.command({
      query: `INSERT INTO ${DATABASE}.trace_metrics (TenantId, TraceId, Origin) VALUES ('t', 'app1', NULL), ('t', 'app2', 'application'), ('t', 'chat1', 'langy'), ('t', 'chat2', 'langy'), ('t', 'sim1', 'simulation'), ('u', 'app1', 'langy')`,
    });
    // Older than the lookup's bound for PERIOD, which is one window back plus a day.
    await client.command({
      query: `INSERT INTO ${DATABASE}.trace_metrics (TenantId, TraceId, Origin, OccurredAt) VALUES ('t', 'old_langy', 'langy', '2026-01-01 00:00:00')`,
    });
    await client.command({
      query: `INSERT INTO ${DATABASE}.spans VALUES ('t', 'app1'), ('t', 'app1'), ('t', 'app2'), ('t', 'chat1'), ('t', 'chat1'), ('t', 'chat2'), ('t', 'sim1'), ('u', 'app1')`,
    });
    await client.command({
      query: `CREATE TABLE ${DATABASE}.mixed_spans (TenantId String, TraceId String) ENGINE = Memory`,
    });
    await client.command({
      query: `INSERT INTO ${DATABASE}.mixed_spans VALUES ('t', 'none1'), ('t', 'none1'), ('t', 'app2'), ('t', 'chat1'), ('t', 'sim1')`,
    });
    await client.command({
      query: `CREATE TABLE ${DATABASE}.old_trace_spans (TenantId String, TraceId String) ENGINE = Memory`,
    });
    await client.command({
      query: `INSERT INTO ${DATABASE}.old_trace_spans VALUES ('t', 'old_langy'), ('t', 'chat1')`,
    });
    await client.command({
      query: `CREATE TABLE ${DATABASE}.evaluations (TenantId String, TraceId Nullable(String)) ENGINE = Memory`,
    });
    await client.command({
      query: `INSERT INTO ${DATABASE}.evaluations VALUES ('t', NULL), ('t', 'app2'), ('t', 'chat1'), ('t', 'none1'), ('t', 'old_langy')`,
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

    // Another project's langy trace shares id "app1"; looked up by trace id alone, ours would drop.
    expect(traces).toBe(3);
    expect(spans).toBe(4);
  });

  /** @scenario "AC193 Sources: a run whose sources hold every origin reads every trace, Langy's included" */
  it("reads every trace and span when the sources hold every origin", async () => {
    const every = ["application", "simulation", "langy", "other"];

    expect(await count(`SELECT count() AS n FROM ${DATABASE}.spans WHERE ${BY_TRACE}`, every)).toBe(
      8,
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
    expect(await count(`SELECT count() AS n FROM ${DATABASE}.trace_metrics`)).toBe(7);
    expect(await count(`SELECT count() AS n FROM ${DATABASE}.spans`)).toBe(8);
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

  describe("given spans of a trace with no trace_metrics row beside traces that have one", () => {
    /** @scenario "AC202g Stock widgets: a trace with no trace_metrics row counts as an application trace" */
    it("counts the trace with no row under the application list", async () => {
      expect(await mixedSpans({ sources: ["application"], trace: "none1" })).toBe(2);
      expect(await mixedSpans({ sources: ["application"], trace: "app2" })).toBe(1);
      expect(await mixedSpans({ sources: ["application"] })).toBe(3);
    });

    /** @scenario "AC202g Stock widgets: a trace with no trace_metrics row counts as an application trace" */
    it("does not count a trace of another source", async () => {
      expect(await mixedSpans({ sources: ["application"], trace: "chat1" })).toBe(0);
      expect(await mixedSpans({ sources: ["application"], trace: "sim1" })).toBe(0);
    });

    /** @scenario "AC202g Stock widgets: a trace with no trace_metrics row counts as an application trace" */
    it("keeps every listed source and the trace with no row under a list of several", async () => {
      const sources = ["application", "langy"];

      expect(await mixedSpans({ sources })).toBe(4);
      expect(await mixedSpans({ sources, trace: "none1" })).toBe(2);
      expect(await mixedSpans({ sources, trace: "chat1" })).toBe(1);
      expect(await mixedSpans({ sources, trace: "sim1" })).toBe(0);
    });

    /** @scenario "AC202g Stock widgets: a trace with no trace_metrics row counts as an application trace" */
    it("keeps only the listed source's traces, not the trace with no row, under a list without application", async () => {
      const sources = ["langy"];

      expect(await mixedSpans({ sources })).toBe(1);
      expect(await mixedSpans({ sources, trace: "chat1" })).toBe(1);
      expect(await mixedSpans({ sources, trace: "none1" })).toBe(0);
      expect(await mixedSpans({ sources, trace: "app2" })).toBe(0);
    });

    /** @scenario "AC202g Stock widgets: a trace with no trace_metrics row counts as an application trace" */
    it("keeps every trace when the list holds every source", async () => {
      expect(await mixedSpans({ sources: [...TRACE_SOURCES] })).toBe(5);
    });

    /** @scenario "AC202g Stock widgets: a trace with no trace_metrics row counts as an application trace" */
    it("keeps no trace under a source name no trace has, not even the trace with no row", async () => {
      expect(await mixedSpans({ sources: ["no_such_source"] })).toBe(0);
      expect(await mixedSpans({ sources: ["no_such_source"], trace: "none1" })).toBe(0);
    });

    /** @scenario "AC200m Sources: a query with no source picked counts nothing and says so" */
    it("returns no row under an empty list, not even the trace with no row", async () => {
      expect(await mixedSpans({ sources: [] })).toBe(0);
      expect(await mixedSpans({ sources: [], trace: "none1" })).toBe(0);
    });

    /** @scenario "AC202g Stock widgets: a trace with no trace_metrics row counts as an application trace" */
    it("counts a span of a trace older than the lookup bound under a list with application", async () => {
      const spans = { table: "old_trace_spans", lookup: BY_TRACE, sources: ["application"] };

      expect(await kept({ ...spans, trace: "old_langy" })).toBe(1);
      expect(await kept({ ...spans, trace: "chat1" })).toBe(0);
    });

    /** @scenario "AC202g Stock widgets: a trace with no trace_metrics row counts as an application trace" */
    it("counts a trace older than the lookup bound under a list with application", async () => {
      const traces = {
        table: "old_trace_spans",
        lookup: TRACES_BY_TRACE,
        sources: ["application"],
      };

      expect(await kept({ ...traces, trace: "old_langy" })).toBe(1);
      expect(await kept({ ...traces, trace: "chat1" })).toBe(0);
    });

    /** @scenario "AC202g Stock widgets: a trace with no trace_metrics row counts as an application trace" */
    it("drops a trace older than the lookup bound under a list without application", async () => {
      const traces = { table: "old_trace_spans", lookup: TRACES_BY_TRACE, sources: ["langy"] };

      expect(await kept({ ...traces, trace: "old_langy" })).toBe(0);
    });
  });

  describe("given evaluations whose trace is of a source, unknown, old or absent", () => {
    /** @scenario "AC202h Stock widgets: evaluation and annotation widgets still read the traces of the chosen sources" */
    it("keeps an evaluation only on a trace of the list", async () => {
      expect(await evaluations({ sources: ["application"], trace: "app2" })).toBe(1);
      expect(await evaluations({ sources: ["application"], trace: "chat1" })).toBe(0);
      expect(await evaluations({ sources: ["langy"], trace: "chat1" })).toBe(1);
    });

    /** @scenario "AC202h Stock widgets: evaluation and annotation widgets still read the traces of the chosen sources" */
    it("drops an evaluation on a trace with no trace_metrics row", async () => {
      expect(await evaluations({ sources: ["application"], trace: "none1" })).toBe(0);
    });

    /** @scenario "AC202h Stock widgets: evaluation and annotation widgets still read the traces of the chosen sources" */
    it("drops an evaluation on a trace older than the lookup bound", async () => {
      // Bound to its own source, so only the bound can drop it.
      expect(await evaluations({ sources: ["langy"], trace: "old_langy" })).toBe(0);
    });

    // Pins today's outcome of the form stock queries already use: if this fails, it is a finding
    // about how ClickHouse treats the NULL row, not a bug in the test.
    /** @scenario "AC202h Stock widgets: evaluation and annotation widgets still read the traces of the chosen sources" */
    it("drops an evaluation whose TraceId is NULL, under one source and under every one", async () => {
      const nullRow = `TraceId IS NULL AND ${EVALUATION_BY_TRACE}`;
      const from = `SELECT count() AS n FROM ${DATABASE}.evaluations WHERE`;

      expect(await count(`${from} TraceId IS NULL`)).toBe(1);
      expect(await count(`${from} ${nullRow}`, ["application"])).toBe(0);
      expect(await count(`${from} ${nullRow}`, [...TRACE_SOURCES])).toBe(0);
    });
  });

  // Seeded here, after every whole-table count above has run, so those counts stay as written.
  describe("given a trace with one application and one langy trace_metrics row", () => {
    beforeAll(async () => {
      await client.command({
        query: `INSERT INTO ${DATABASE}.trace_metrics (TenantId, TraceId, Origin) VALUES ('t', 'dual1', 'application'), ('t', 'dual1', 'langy')`,
      });
      await client.command({
        query: `CREATE TABLE ${DATABASE}.dual_spans (TenantId String, TraceId String) ENGINE = Memory`,
      });
      await client.command({ query: `INSERT INTO ${DATABASE}.dual_spans VALUES ('t', 'dual1')` });
    });

    /** @scenario "AC202g Stock widgets: a trace with no trace_metrics row counts as an application trace" */
    it("drops the trace under application and keeps it under langy", async () => {
      const spans = { table: "dual_spans", lookup: BY_TRACE, trace: "dual1" };

      expect(await kept({ ...spans, sources: ["application"] })).toBe(0);
      expect(await kept({ ...spans, sources: ["langy"] })).toBe(1);
    });
  });
});
