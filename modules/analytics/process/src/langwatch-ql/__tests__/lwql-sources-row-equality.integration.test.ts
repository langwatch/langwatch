/**
 * Each stock query over `traces` or `spans` returns, on a real ClickHouse, the rows main's SQL for
 * it returns, apart from the traces AC202g names. Tables shaped as the catalogue's views stand in
 * for them; the queries come from the committed copies of the catalogue's SQL, here and on main.
 * @see modules/dashboard/specs/dashboards-v2.feature AC202d, AC202g
 * @vitest-environment node
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { LWQL_VIEW_CATALOG } from "../../rules/lwql-view-catalog.rules.ts";

const url =
  process.env.LANGWATCH_TEST_CLICKHOUSE_URL ??
  process.env.TEST_CLICKHOUSE_URL ??
  process.env.CI_CLICKHOUSE_URL;
const DATABASE = `lwql_source_rows_${process.pid}`;

const SOURCES = "{dashboard_context_sources:Array(String)}";
const CHOSEN = `has(${SOURCES}, 'application')`;
const LISTS = [{ list: ["application"] }, { list: ["langy"] }];

type StockQuery = { label: string; sql: string };

function fixture(name: string): readonly StockQuery[] {
  return JSON.parse(
    readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8"),
  );
}

const STOCK = fixture("stock-widget-queries.json");
// `git show origin/main:<this directory>/fixtures/stock-widget-queries.json` at 5b4a4e3f2b,
// main's single lookups, each with the bound it shipped with.
const ON_MAIN = new Map(fixture("stock-widget-queries.before.json").map((q) => [q.label, q.sql]));
// ck-trend/changes as this branch shipped it at a67bf1eb57, its lookup bound one window and a day.
const [WINDOW_BOUND] = fixture("stock-widget-queries.window-bound.json");

/** Stock queries new since main, whose baseline is the rebuilt single lookup. */
const NEW_SINCE_MAIN: readonly string[] = [];

/**
 * Rows that differ by design (AC202g), by widget query and list. Both changes queries scan 90 days
 * back, and their lookup now reaches as far; main's stopped one window and a day back.
 */
const AC202G_EXCEPTIONS: Record<string, Readonly<Record<string, string>>> = {
  "ck-trend/changes": {
    application: "none_old, with no row, counts: pv_shared is first seen 85 days back",
    langy: "langy_old and dual_old are in the bound: pv_langy is first seen 85 days back",
  },
  "ext-cost-per-doc/changes": {
    application: "none_old, with no row, counts: pv_shared is first seen 85 days back",
    langy: "langy_old and dual_old are in the bound: pv_langy is first seen 85 days back",
  },
};

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The two-set form a stock query keeps `traces` and `spans` with; both sets share one bound. */
const TWO_SETS = new RegExp(
  `\\(${escaped(CHOSEN)} OR (\\(\\w+\\.TenantId, \\w+\\.TraceId\\)) IN ` +
    escaped(
      `(SELECT TenantId, TraceId FROM trace_metrics WHERE NOT ${CHOSEN} AND Source IN ${SOURCES}`,
    ) +
    `((?: AND OccurredAt >= [^\\n]*?)?)\\)\\) AND \\1 NOT IN ` +
    escaped(
      `(SELECT TenantId, TraceId FROM trace_metrics WHERE ${CHOSEN} AND Source NOT IN ${SOURCES}`,
    ) +
    `\\2\\)`,
  "g",
);

/** How many times the SQL selects from `traces`, `spans` or `span_metrics`. */
function traceViewReads(sql: string): number {
  return [...sql.matchAll(/\bFROM\s+(?:analytics\.)?(?:traces|spans|span_metrics)\b/gi)].length;
}

/** The views the SQL names after FROM or JOIN. */
function namedViews(sql: string): string[] {
  return [...sql.matchAll(/\b(?:FROM|JOIN)\s+(?:analytics\.)?([a-z_]+)/gi)].map(
    (match) => match[1] ?? "",
  );
}

/** The query as it was before, each two-set form back to the single lookup, and how many. */
function singleLookupForm(sql: string): { sql: string; replaced: number } {
  let replaced = 0;
  const before = sql.replace(TWO_SETS, (_form, key: string) => {
    replaced++;
    return `${key} IN (SELECT TenantId, TraceId FROM trace_metrics WHERE Source IN ${SOURCES})`;
  });

  return { sql: before, replaced };
}

/** Whether two statements read the same views. */
function readsSameViews(one: string, other: string): boolean {
  const [a, b] = [one, other].map((sql) => [...new Set(namedViews(sql))].toSorted().join());
  return a === b;
}

/**
 * Main's SQL for the query, or the rebuilt single lookup for a query new since main or moved to
 * other views since (analytics ADR-006), so only the lookup differs from the query it checks.
 */
function baselineOf({ label, sql }: StockQuery): string {
  const main = ON_MAIN.get(label);
  return main !== undefined && readsSameViews(main, sql) ? main : singleLookupForm(sql).sql;
}

/** Every stock query kept to its sources that reads a trace or span view, from the fixture. */
const COVERED = STOCK.filter(({ sql }) => sql.includes(SOURCES) && traceViewReads(sql) > 0);

const labelsOf = (queries: readonly StockQuery[]) => queries.map(({ label }) => label);

describe("given the stock queries that keep traces or spans to their sources", () => {
  /** @scenario "AC202d Stock widgets: a widget whose list did not change returns the same rows" */
  it("turns every one of their trace view reads back into the single lookup", () => {
    // The stock queries that read traces, spans or span_metrics with the sources parameter: 58
    // before tasks#1117 moved 15 to trace_metrics, 43 before analytics ADR-004 moved 20 more off.
    expect(COVERED).toHaveLength(23);

    const missed = COVERED.flatMap(({ label, sql }) => {
      const { sql: before, replaced } = singleLookupForm(sql);
      const reads = traceViewReads(sql);
      return replaced === reads && !before.includes(CHOSEN)
        ? []
        : [`${label}: ${replaced} of ${reads} reads`];
    });

    expect(missed).toEqual([]);
    expect(Object.keys(AC202G_EXCEPTIONS).filter((label) => !hasLabel(label))).toEqual([]);
  });

  /** @scenario "AC202d Stock widgets: a widget whose list did not change returns the same rows" */
  it("takes each one's baseline from main's SQL, which holds no two-set form", () => {
    expect(labelsOf(COVERED.filter(({ label }) => !ON_MAIN.has(label)))).toEqual(NEW_SINCE_MAIN);
    expect(labelsOf(COVERED.filter(({ label }) => ON_MAIN.get(label)?.includes(CHOSEN)))).toEqual(
      [],
    );
  });
});

function hasLabel(label: string): boolean {
  return COVERED.some((query) => query.label === label);
}

const DAY = 86_400_000;
const PERIOD_END = Math.floor(Date.now() / DAY) * DAY;
const PERIOD_START = PERIOD_END - 7 * DAY;
/** Within the changes widgets' 90 days, past every window bound, and before `now() - 90 days`. */
const OLD = PERIOD_START - 85 * DAY;

/** A DateTime literal with no fraction, which a `DateTime` parameter and column both parse. */
const at = (time: number) => new Date(time).toISOString().slice(0, 19).replace("T", " ");
const PARAMETERS = {
  dashboard_context_period_start: at(PERIOD_START),
  dashboard_context_period_end: at(PERIOD_END),
  dashboard_context_granularity_seconds: 86_400,
};

type Seed = { trace: string; time: number; sources: string[]; prompt?: string; score?: number };

/** Ordinary traces of each source, then AC202g's: no row, two sources, older than the bound. */
const SEEDS: Seed[] = [
  { trace: "app_a", time: periodDay(2), sources: ["application"], prompt: "pv_shared", score: 0.8 },
  { trace: "app_b", time: periodDay(3), sources: ["application"], prompt: "pv_dual", score: 0.1 },
  { trace: "chat_a", time: periodDay(2.5), sources: ["langy"], prompt: "pv_langy", score: 0.5 },
  { trace: "sim_a", time: periodDay(4), sources: ["simulation"], score: 0.9 },
  { trace: "none_old", time: OLD, sources: [], prompt: "pv_shared", score: 0.3 },
  { trace: "dual_old", time: OLD, sources: ["application", "langy"], prompt: "pv_dual" },
  { trace: "langy_old", time: OLD, sources: ["langy"], prompt: "pv_langy" },
];

function periodDay(days: number): number {
  return PERIOD_START + days * DAY;
}

function seedRows(): Record<string, Record<string, unknown>[]> {
  const base = (seed: Seed) => ({ TenantId: "tenant", TraceId: seed.trace });
  const failing = (seed: Seed) => seed.trace.endsWith("_b") || seed.trace.startsWith("sim");
  const topic = (seed: Seed) => (seed.trace.endsWith("_b") ? "topic_refunds" : "topic_billing");

  return {
    trace_metrics: SEEDS.flatMap((seed) =>
      seed.sources.map((source) => ({
        ...base(seed),
        OccurredAt: at(seed.time),
        UpdatedAt: at(seed.time),
        TraceName: seed.trace,
        Origin: source,
        Source: source,
        Models: ["gpt-5"],
        TotalCost: 0.02,
        TotalDurationMs: 1200,
        HasError: failing(seed),
        TopicId: topic(seed),
        UserId: `user_${seed.trace}`,
      })),
    ),
    traces: SEEDS.map((seed) => ({
      ...base(seed),
      OccurredAt: at(seed.time),
      UpdatedAt: at(seed.time),
      TraceName: seed.trace,
      TotalDurationMs: 1200,
      SpanCount: 2,
      ContainsErrorStatus: failing(seed),
      ContainsOKStatus: !failing(seed),
      Models: ["gpt-5"],
      TotalCost: 0.02,
      SatisfactionScore: seed.score ?? null,
      TopicId: topic(seed),
      LastUsedPromptVersionId: seed.prompt ?? null,
      Attributes: { "metadata.user_id": `user_${seed.trace}` },
    })),
    spans: SEEDS.flatMap((seed) => spansOf({ seed, failing: failing(seed) })),
    // The same spans as span_metrics' typed columns.
    span_metrics: SEEDS.flatMap((seed) =>
      spansOf({ seed, failing: failing(seed) }).map(
        ({ ServiceName: _service, SpanAttributes: _attributes, ...typed }) => ({
          ...typed,
          SpanType: String(typed.SpanName).split(".")[0],
        }),
      ),
    ),
    evaluations: SEEDS.map((seed) => ({
      ...base(seed),
      EvaluationId: `eval_${seed.trace}`,
      EvaluatorId: "answered",
      EvaluatorType: "langevals/llm_boolean",
      EvaluatorName: "Answered",
      Status: "processed",
      Score: failing(seed) ? 0 : 1,
      Passed: failing(seed) ? 0 : 1,
      ScheduledAt: at(seed.time),
      CompletedAt: at(seed.time),
      UpdatedAt: at(seed.time),
    })),
    evaluation_metrics: SEEDS.flatMap((seed) =>
      seed.sources.slice(0, 1).map((source) => ({
        ...base(seed),
        EvaluationId: `eval_${seed.trace}`,
        OccurredAt: at(seed.time),
        UpdatedAt: at(seed.time),
        EvaluatorType: "langevals/llm_boolean",
        EvaluatorName: "Answered",
        Status: "processed",
        Passed: !failing(seed),
        Score: failing(seed) ? 0 : 1,
        Origin: source,
        Source: source,
      })),
    ),
    // The same verdicts beside their trace's time, topic and source (analytics ADR-007).
    trace_evaluation_metrics: SEEDS.flatMap((seed) =>
      seed.sources.slice(0, 1).map((source) => ({
        ...base(seed),
        EvaluationId: `eval_${seed.trace}`,
        OccurredAt: at(seed.time),
        UpdatedAt: at(seed.time),
        TraceOccurredAt: at(seed.time),
        EvaluatorName: "Answered",
        Status: "processed",
        IsGuardrail: false,
        Passed: !failing(seed),
        Source: source,
        TraceSource: source,
        TopicId: topic(seed),
      })),
    ),
    topics: ["topic_billing", "topic_refunds"].map((id) => ({
      TenantId: "tenant",
      TopicId: id,
      TopicName: id.replace("topic_", ""),
      AutomaticallyGenerated: true,
      CreatedAt: at(OLD),
      UpdatedAt: at(OLD),
    })),
  };
}

/** A seed's root, tool and LLM spans. */
function spansOf({ seed, failing }: { seed: Seed; failing: boolean }): Record<string, unknown>[] {
  return [
    span({ seed, id: "root", parent: null, status: failing ? 2 : 1, name: "agent" }),
    span({ seed, id: "tool", parent: "root", status: 2, name: "tool.search" }),
    span({ seed, id: "llm", parent: "root", status: 0, name: "llm.chat" }),
  ];
}

function span({
  seed,
  id,
  parent,
  status,
  name,
}: {
  seed: Seed;
  id: string;
  parent: string | null;
  status: number;
  name: string;
}): Record<string, unknown> {
  return {
    TenantId: "tenant",
    TraceId: seed.trace,
    SpanId: `${seed.trace}_${id}`,
    ParentSpanId: parent ? `${seed.trace}_${parent}` : null,
    StartTime: at(seed.time),
    EndTime: at(seed.time + 1000),
    DurationMs: 1000,
    SpanName: name,
    SpanKind: 1,
    ServiceName: "agent",
    StatusCode: status,
    Cost: 0.01,
    SpanAttributes: { "gen_ai.operation.name": name },
  };
}

/** The server's URL on this suite's database: the client takes a URL path over `database`. */
function urlOnDatabase(): string {
  const onDatabase = new URL(String(url));
  onDatabase.pathname = `/${DATABASE}`;

  return onDatabase.toString();
}

/** The prompts the query's 90-day `traces` read finds, before the widget keeps only new ones. */
function promptsRead(sql: string): string {
  const derived = sql.slice(
    sql.indexOf("FROM (\n") + 5,
    sql.lastIndexOf("\n)\nWHERE first_at") + 2,
  );

  return `SELECT name FROM ${derived} WHERE kind = 'prompt' ORDER BY name`;
}

type Failure = { label: string; error: string };

/** The failures in one line, naming the first and its error, for a log cut short. */
function failureNote(failures: readonly Failure[]): string {
  const [first] = failures;
  return first ? `${failures.length} queries failed; first, ${first.label}: ${first.error}` : "";
}

describe.skipIf(!url)("given ordinary traces of each source beside the traces AC202g names", () => {
  let admin: ClickHouseClient;
  let client: ClickHouseClient;

  async function rowsOf({ sql, list }: { sql: string; list: readonly string[] }) {
    const result = await client.query({
      query: sql,
      query_params: { ...PARAMETERS, dashboard_context_sources: list },
      format: "JSONEachRow",
      clickhouse_settings: { max_threads: 1 },
    });

    return result.json<Record<string, unknown>>();
  }

  /** The query's rows in a stable order, or its error, so one failure does not hide the rest. */
  async function run(args: {
    sql: string;
    list: readonly string[];
  }): Promise<{ rows?: string; error?: string }> {
    try {
      const rows = (await rowsOf(args)).map((row) => JSON.stringify(row));
      return { rows: JSON.stringify(rows.toSorted()) };
    } catch (error) {
      return { error: error instanceof Error ? error.message.slice(0, 600) : String(error) };
    }
  }

  beforeAll(async () => {
    admin = createClient({ url });
    await admin.command({ query: `DROP DATABASE IF EXISTS ${DATABASE}` });
    await admin.command({ query: `CREATE DATABASE ${DATABASE}` });
    client = createClient({ url: urlOnDatabase() });

    const views = new Set(
      COVERED.flatMap((query) => [...namedViews(query.sql), ...namedViews(baselineOf(query))]),
    );
    for (const name of views) {
      const view = LWQL_VIEW_CATALOG.find((candidate) => candidate.name === name);
      if (!view) throw new Error(`a stock query reads "${name}", which the catalogue lacks`);
      const columns = view.columns.map((column) => `\`${column.name}\` ${column.type}`);
      await client.command({
        query: `CREATE TABLE ${DATABASE}.${name} (${columns.join(", ")}) ENGINE = Memory`,
      });
    }

    for (const [table, values] of Object.entries(seedRows())) {
      // A seeded view no covered query or baseline reads has no table.
      if (!views.has(table)) continue;
      await client.insert({ table: `${DATABASE}.${table}`, values, format: "JSONEachRow" });
    }
  });

  afterAll(async () => {
    await admin.command({ query: `DROP DATABASE IF EXISTS ${DATABASE}` });
    await client.close();
    await admin.close();
  });

  /** @scenario "AC202d Stock widgets: a widget whose list did not change returns the same rows" */
  it.each(LISTS)(
    "returns main's rows under $list, apart from the AC202g exceptions",
    async ({ list }) => {
      const failures: Failure[] = [];
      const differing: string[] = [];
      for (const query of COVERED) {
        const current = await run({ sql: query.sql, list });
        const before = await run({ sql: baselineOf(query), list });
        if (current.error) failures.push({ label: query.label, error: `now: ${current.error}` });
        if (before.error) failures.push({ label: query.label, error: `main: ${before.error}` });
        if (!current.error && !before.error && current.rows !== before.rows) {
          differing.push(query.label);
        }
      }

      const expected = Object.entries(AC202G_EXCEPTIONS)
        .filter(([, lists]) => lists[list.join()] !== undefined)
        .map(([label]) => label);
      expect(failures, failureNote(failures)).toEqual([]);
      expect(
        differing.toSorted(),
        `differing under ${list.join()}: ${differing.join(", ")}`,
      ).toEqual(expected.toSorted());
    },
  );

  /** @scenario "AC202d Stock widgets: a widget whose list did not change returns the same rows" */
  it("seeds traces whose source changes the rows of many stock queries", async () => {
    const failures: Failure[] = [];
    const changed: string[] = [];
    for (const { label, sql } of COVERED) {
      const [application, langy] = await Promise.all(LISTS.map(({ list }) => run({ sql, list })));
      const error = application?.error ?? langy?.error;
      if (error) failures.push({ label, error });
      else if (application?.rows !== langy?.rows) changed.push(label);
    }

    expect(failures, failureNote(failures)).toEqual([]);
    expect(changed.length, `changed: ${changed.join(", ")}`).toBeGreaterThanOrEqual(10);
  });

  /** The prompts the query's traces read finds under `list`, by name. */
  async function prompts({ sql, list }: { sql: string; list: readonly string[] }) {
    const rows = await rowsOf({ sql: promptsRead(sql), list });
    return rows.map((row) => row.name);
  }

  /** @scenario "AC202g Stock widgets: a trace with no trace_metrics row counts as an application trace" */
  it("leaves langy_old's prompt out of ck-trend/changes under application, not langy", async () => {
    const sql = STOCK.find(({ label }) => label === "ck-trend/changes")?.sql ?? "";
    expect(sql).toContain("least(");

    expect(await prompts({ sql, list: ["application"] })).toEqual(["pv_dual", "pv_shared"]);
    expect(await prompts({ sql, list: ["langy"] })).toEqual(["pv_dual", "pv_langy"]);
  });

  /** @scenario "AC202g Stock widgets: a trace with no trace_metrics row counts as an application trace" */
  it("would read langy_old's prompt under application with the window bound alone", async () => {
    expect(WINDOW_BOUND?.label).toBe("ck-trend/changes");
    expect(WINDOW_BOUND?.sql).not.toContain("least(");

    expect(await prompts({ sql: WINDOW_BOUND?.sql ?? "", list: ["application"] })).toEqual([
      "pv_dual",
      "pv_langy",
      "pv_shared",
    ]);
  });
});
