/**
 * Each stock query over `traces` or `spans` returns, on a real ClickHouse, the rows its old single
 * lookup returned, apart from the traces AC202g names. Tables shaped as the catalogue's views stand
 * in for them; the queries come from the committed copy of the catalogue's SQL.
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

const STOCK: readonly { label: string; sql: string }[] = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("./fixtures/stock-widget-queries.json", import.meta.url)),
    "utf8",
  ),
);

/**
 * Rows that differ by design (AC202g), by widget query, with the lists they differ under. The
 * trace older than the bound is no exception: each lookup reaches as far back as its query scans.
 */
const AC202G_EXCEPTIONS: Record<string, { lists: readonly string[]; reason: string }> = {
  "ck-trend/changes": {
    lists: ["application"],
    reason: "its 90-day scan reaches the old trace with no row and the old two-source trace",
  },
  "ext-cost-per-doc/changes": {
    lists: ["application"],
    reason: "its 90-day scan reaches the old trace with no row and the old two-source trace",
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

/** How many times the SQL selects from `traces` or `spans`. */
function traceViewReads(sql: string): number {
  return [...sql.matchAll(/\bFROM\s+(?:analytics\.)?(?:traces|spans)\b/gi)].length;
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

/** Every stock query kept to its sources that reads `traces` or `spans`, from the fixture. */
const COVERED = STOCK.filter(({ sql }) => sql.includes(SOURCES) && traceViewReads(sql) > 0);

describe("given the stock queries that keep traces or spans to their sources", () => {
  /** @scenario "AC202d Stock widgets: a widget whose list did not change returns the same rows" */
  it("turns every one of their trace view reads back into the single lookup", () => {
    expect(COVERED.length).toBeGreaterThan(50);

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
});

function hasLabel(label: string): boolean {
  return COVERED.some((query) => query.label === label);
}

const DAY = 86_400_000;
const PERIOD_END = Math.floor(Date.now() / DAY) * DAY;
const PERIOD_START = PERIOD_END - 7 * DAY;
/** Within the changes widgets' 90 days, past every window bound, and before `now() - 90 days`. */
const OLD = PERIOD_START - 85 * DAY;

const at = (time: number) => new Date(time).toISOString().replace("T", " ").replace("Z", "");
const PARAMETERS = {
  dashboard_context_period_start: at(PERIOD_START).slice(0, 19),
  dashboard_context_period_end: at(PERIOD_END).slice(0, 19),
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
    spans: SEEDS.flatMap((seed) => [
      span({ seed, id: "root", parent: null, status: failing(seed) ? 2 : 1, name: "agent" }),
      span({ seed, id: "tool", parent: "root", status: 2, name: "tool.search" }),
      span({ seed, id: "llm", parent: "root", status: 0, name: "llm.chat" }),
    ]),
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

    return JSON.stringify(await result.json());
  }

  beforeAll(async () => {
    admin = createClient({ url });
    await admin.command({ query: `CREATE DATABASE IF NOT EXISTS ${DATABASE}` });
    client = createClient({ url, database: DATABASE });

    const views = new Set(COVERED.flatMap(({ sql }) => namedViews(sql)));
    for (const name of views) {
      const view = LWQL_VIEW_CATALOG.find((candidate) => candidate.name === name);
      if (!view) throw new Error(`a stock query reads "${name}", which the catalogue lacks`);
      const columns = view.columns.map((column) => `\`${column.name}\` ${column.type}`);
      await client.command({
        query: `CREATE TABLE ${DATABASE}.${name} (${columns.join(", ")}) ENGINE = Memory`,
      });
    }

    for (const [table, values] of Object.entries(seedRows())) {
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
    "returns the single lookup's rows under $list, apart from the AC202g exceptions",
    async ({ list }) => {
      const differing: string[] = [];
      for (const { label, sql } of COVERED) {
        const current = await rowsOf({ sql, list });
        const before = await rowsOf({ sql: singleLookupForm(sql).sql, list });
        if (current !== before) differing.push(label);
      }

      const expected = Object.entries(AC202G_EXCEPTIONS)
        .filter(([, { lists }]) => lists.includes(list.join()))
        .map(([label]) => label);
      expect(differing.sort()).toEqual(expected.sort());
    },
  );

  /** @scenario "AC202d Stock widgets: a widget whose list did not change returns the same rows" */
  it("seeds traces whose source changes the rows of many stock queries", async () => {
    let changed = 0;
    for (const { sql } of COVERED) {
      const [application, langy] = await Promise.all(
        LISTS.map(({ list }) => rowsOf({ sql, list })),
      );
      if (application !== langy) changed++;
    }

    expect(changed).toBeGreaterThanOrEqual(10);
  });
});
