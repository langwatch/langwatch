/**
 * The stock queries moved from `traces` to `trace_metrics` (tasks#1117) return, on a real
 * ClickHouse, the rows their `traces` form returns under the application and the langy lists.
 * Tables shaped as the catalogue's views stand in for them; both forms come from committed fixtures.
 * @see specs/lwql/stock-widgets-on-trace-metrics.feature
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
const DATABASE = `lwql_trace_metrics_rows_${process.pid}`;

const LISTS = [{ list: ["application"] }, { list: ["langy"] }];

type StockQuery = { label: string; sql: string };

function fixture(name: string): readonly StockQuery[] {
  return JSON.parse(
    readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8"),
  );
}

// The `traces` form each moved query had on main before tasks#1117, as the catalogue stored it.
const BASELINE = fixture("stock-widget-queries.traces-baseline.json");
const STOCK = new Map(fixture("stock-widget-queries.json").map((q) => [q.label, q.sql]));

/** The queries that sum `TotalCost`: a trace with two `trace_metrics` rows adds its cost twice. */
const SUMS_COST = [
  "cost-by-segment/units",
  "cost-by-segment/totals",
  "att-share/units",
  "att-share/totals",
  "att-table/units",
];

const DAY = 86_400_000;
const PERIOD_END = Math.floor(Date.now() / DAY) * DAY;
const PERIOD_START = PERIOD_END - 7 * DAY;

/** A DateTime literal with no fraction, which a `DateTime` parameter and column both parse. */
const at = (time: number) => new Date(time).toISOString().slice(0, 19).replace("T", " ");
const PARAMETERS = {
  dashboard_context_period_start: at(PERIOD_START),
  dashboard_context_period_end: at(PERIOD_END),
  dashboard_context_granularity_seconds: 86_400,
};

type Seed = {
  trace: string;
  /** Days after the period start; negative is the window before it. */
  day: number;
  /** The source of its `trace_metrics` row; null for a trace with no row there. */
  source: string | null;
  metadata: Record<string, string>;
  customer?: string;
  labels?: string[];
  thread?: string;
  topic?: string;
  cost: number;
};

/** Every metadata key the moved queries read, spread over each source, with distinct shares. */
const SEEDS: Seed[] = [
  {
    trace: "app_1",
    day: 1,
    source: "application",
    customer: "acme",
    labels: ["vip", "beta"],
    thread: "thread_1",
    topic: "topic_billing",
    cost: 0.25,
    metadata: {
      output_action: "accepted",
      outcome: "resolved",
      sent_to_review: "false",
      document_type: "invoice",
      language: "en",
    },
  },
  {
    trace: "app_2",
    day: 2,
    source: "application",
    customer: "acme",
    thread: "thread_1",
    cost: 0.5,
    metadata: {
      output_action: "edited",
      outcome: "handover",
      sent_to_review: "true",
      document_type: "receipt",
      language: "nl",
      topic: "refunds",
    },
  },
  {
    trace: "app_3",
    day: 3.5,
    source: "application",
    customer: "globex",
    labels: ["beta"],
    cost: 0.125,
    metadata: {
      output_action: "regenerated",
      sent_to_review: "true",
      document_type: "invoice",
      team: "support",
      flow: "intake",
      segment: "smb",
    },
  },
  {
    trace: "app_before",
    day: -2,
    source: "application",
    topic: "topic_billing",
    cost: 0.25,
    metadata: { topic: "billing" },
  },
  {
    trace: "chat_1",
    day: 1.5,
    source: "langy",
    labels: ["x"],
    thread: "thread_9",
    cost: 0.5,
    metadata: {
      output_action: "accepted",
      outcome: "handover",
      document_type: "contract",
      language: "de",
    },
  },
  {
    trace: "chat_2",
    day: 4,
    source: "langy",
    cost: 0.25,
    metadata: {
      outcome: "resolved",
      sent_to_review: "false",
      document_type: "contract",
      topic: "billing",
    },
  },
  {
    trace: "chat_before",
    day: -1,
    source: "langy",
    topic: "topic_refunds",
    cost: 0.125,
    metadata: { topic: "refunds" },
  },
  {
    trace: "sim_1",
    day: 2,
    source: "simulation",
    customer: "acme",
    cost: 1,
    metadata: { output_action: "accepted", outcome: "handover", document_type: "invoice" },
  },
  {
    trace: "no_row",
    day: 3,
    source: null,
    customer: "initech",
    cost: 1,
    metadata: { output_action: "accepted", outcome: "handover", document_type: "invoice" },
  },
];

const timeOf = (seed: Seed) => PERIOD_START + seed.day * DAY;

function metricsRow(seed: Seed, source: string): Record<string, unknown> {
  const value = (key: string) => seed.metadata[key] ?? "";
  return {
    TenantId: "tenant",
    TraceId: seed.trace,
    OccurredAt: at(timeOf(seed)),
    UpdatedAt: at(timeOf(seed)),
    TraceName: seed.trace,
    TopicId: seed.topic ?? null,
    ConversationId: seed.thread ?? null,
    CustomerId: seed.customer ?? null,
    Origin: source,
    Source: source,
    Models: ["gpt-5"],
    Labels: seed.labels ?? [],
    TotalCost: seed.cost,
    TotalDurationMs: 1200,
    HasError: false,
    MetadataOutputAction: value("output_action"),
    MetadataOutcome: value("outcome"),
    MetadataSentToReview: value("sent_to_review"),
    MetadataDocumentType: value("document_type"),
    MetadataFlow: value("flow"),
    MetadataLanguage: value("language"),
    MetadataSegment: value("segment"),
    MetadataTeam: value("team"),
    MetadataTopic: value("topic"),
  };
}

function traceRow(seed: Seed): Record<string, unknown> {
  const attributes: Record<string, string> = Object.fromEntries(
    Object.entries(seed.metadata).map(([key, value]) => [`metadata.${key}`, value]),
  );
  if (seed.customer) attributes["langwatch.customer_id"] = seed.customer;
  if (seed.labels) attributes["langwatch.labels"] = JSON.stringify(seed.labels);
  if (seed.thread) attributes["langwatch.thread.id"] = seed.thread;
  return {
    TenantId: "tenant",
    TraceId: seed.trace,
    OccurredAt: at(timeOf(seed)),
    UpdatedAt: at(timeOf(seed)),
    TraceName: seed.trace,
    TotalDurationMs: 1200,
    Models: ["gpt-5"],
    TotalCost: seed.cost,
    TopicId: seed.topic ?? null,
    Attributes: attributes,
  };
}

function seedRows(): Record<string, Record<string, unknown>[]> {
  return {
    traces: SEEDS.map(traceRow),
    trace_metrics: SEEDS.flatMap((seed) => (seed.source ? [metricsRow(seed, seed.source)] : [])),
    topics: ["topic_billing", "topic_refunds"].map((id) => ({
      TenantId: "tenant",
      TopicId: id,
      TopicName: id.replace("topic_", ""),
      AutomaticallyGenerated: true,
      CreatedAt: at(PERIOD_START),
      UpdatedAt: at(PERIOD_START),
    })),
  };
}

/** The views the SQL names after FROM or JOIN. */
function namedViews(sql: string): string[] {
  return [...sql.matchAll(/\b(?:FROM|JOIN)\s+(?:analytics\.)?([a-z_]+)/gi)].map(
    (match) => match[1] ?? "",
  );
}

/** The server's URL on this suite's database: the client takes a URL path over `database`. */
function urlOnDatabase(): string {
  const onDatabase = new URL(String(url));
  onDatabase.pathname = `/${DATABASE}`;

  return onDatabase.toString();
}

describe.skipIf(!url)("given traces of each source carrying the metadata the widgets read", () => {
  let admin: ClickHouseClient;
  let client: ClickHouseClient;

  /** The query's rows in a stable order, or its error, so one failure does not hide the rest. */
  async function run({
    sql,
    list,
  }: {
    sql: string;
    list: readonly string[];
  }): Promise<{ rows?: string; error?: string }> {
    try {
      const result = await client.query({
        query: sql,
        query_params: { ...PARAMETERS, dashboard_context_sources: list },
        format: "JSONEachRow",
        clickhouse_settings: { max_threads: 1 },
      });
      const rows = (await result.json<Record<string, unknown>>()).map((row) => JSON.stringify(row));
      return { rows: JSON.stringify(rows.toSorted()) };
    } catch (error) {
      return { error: error instanceof Error ? error.message.slice(0, 600) : String(error) };
    }
  }

  /** The moved queries whose rows differ from their `traces` form under `list`. */
  async function differing(list: readonly string[]): Promise<string[]> {
    const labels: string[] = [];
    for (const { label, sql } of BASELINE) {
      const now = await run({ sql: STOCK.get(label) ?? "", list });
      const before = await run({ sql, list });
      expect(now.error, `${label} now`).toBeUndefined();
      expect(before.error, `${label} before`).toBeUndefined();
      expect(now.rows, `${label} returns rows`).not.toBe("[]");
      if (now.rows !== before.rows) labels.push(label);
    }
    return labels;
  }

  beforeAll(async () => {
    admin = createClient({ url });
    await admin.command({ query: `DROP DATABASE IF EXISTS ${DATABASE}` });
    await admin.command({ query: `CREATE DATABASE ${DATABASE}` });
    client = createClient({ url: urlOnDatabase() });

    const views = new Set(
      BASELINE.flatMap(({ label, sql }) => [
        ...namedViews(sql),
        ...namedViews(STOCK.get(label) ?? ""),
      ]),
    );
    for (const name of views) {
      const view = LWQL_VIEW_CATALOG.find((candidate) => candidate.name === name);
      if (!view) throw new Error(`a moved query reads "${name}", which the catalogue lacks`);
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

  /** @scenario "A moved widget query returns the rows its traces form returned" */
  it.each(LISTS)("returns each moved query's traces rows under $list", async ({ list }) => {
    expect(BASELINE).toHaveLength(14);
    expect(await differing(list)).toEqual([]);
  });

  /** @scenario "A moved widget query returns the rows its traces form returned" */
  it("seeds traces whose source changes the rows of the moved queries", async () => {
    const changed: string[] = [];
    for (const { label } of BASELINE) {
      const sql = STOCK.get(label) ?? "";
      const [application, langy] = await Promise.all(LISTS.map(({ list }) => run({ sql, list })));
      if (application?.rows !== langy?.rows) changed.push(label);
    }

    expect(changed.length, `changed: ${changed.join(", ")}`).toBeGreaterThanOrEqual(12);
  });

  /** @scenario "A trace with two trace_metrics rows adds its cost twice to the summed widgets" */
  it("differs only in summed cost when a trace has two rows in trace_metrics", async () => {
    const [first] = SEEDS;
    if (!first) throw new Error("no seed");
    // A row written before the storage anchor froze, whose OccurredAt later moved (ADR-082).
    const moved = {
      ...metricsRow(first, "application"),
      OccurredAt: at(timeOf(first) + 3_600_000),
    };
    await client.insert({
      table: `${DATABASE}.trace_metrics`,
      values: [moved],
      format: "JSONEachRow",
    });

    expect((await differing(["application"])).toSorted()).toEqual(SUMS_COST.toSorted());
    expect(await differing(["langy"])).toEqual([]);
  });
});
