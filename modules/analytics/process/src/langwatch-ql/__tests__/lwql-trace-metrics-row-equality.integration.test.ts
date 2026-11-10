/**
 * @vitest-environment node
 * Each query moved to trace_metrics (tasks#1117) returns its traces-form rows on the shipped
 * migrations and views. @see specs/lwql/stock-widgets-on-trace-metrics.feature
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { LangWatchQLViewProvisioningService } from "../../features/provisioning/services/langwatch-ql-view-provisioning.service.ts";
import { SHIPPED_LWQL_DEDUP } from "../../features/provisioning/services/langwatch-ql-view-statements.service.ts";
import { LWQL_VIEW_CATALOG } from "../../rules/lwql-view-catalog.rules.ts";
import {
  expectRestrictedIdentity,
  type LangWatchQLClickHouseHarness,
  type LangWatchQLPostgresHarness,
  mapPostgresIntoClickHouse,
  startLangWatchQLClickHouse,
  startLangWatchQLPostgres,
  TENANT_A,
} from "./lwql-clickhouse-harness.ts";

const viewProvisioning = LangWatchQLViewProvisioningService.create();

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

/** The queries that split the period into halves, windows or buckets by a row's OccurredAt. */
const SPLITS = [
  "ask-rising/shares",
  "ask-rising/daily",
  "ext-human-review/trend",
  "ext-human-review/summary",
  "gen-acceptance/actions",
];

/** The moved queries that keep each trace's first trace_metrics row, by the filter's lookup. */
const FILTERED = BASELINE.map(({ label }) => label).filter((label) =>
  STOCK.get(label)?.includes("min(OccurredAt)"),
);

const TENANT = TENANT_A.tenantId;
/** Topics the Postgres harness seeds for every tenant; the `topics` view reads them. */
const TOPIC_ONE = `${TENANT}-topic-1`;
const TOPIC_TWO = `${TENANT}-topic-2`;

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
  /** The `Origin` of its `trace_analytics` row, whose `Source` the view derives; null for none. */
  origin: string | null;
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
    origin: "application",
    customer: "acme",
    labels: ["vip", "beta"],
    thread: "thread_1",
    topic: TOPIC_ONE,
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
    origin: "application",
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
    origin: "application",
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
    // An empty Origin counts as application through the view's derived `Source`.
    trace: "app_no_origin",
    day: 2.5,
    origin: "",
    customer: "globex",
    cost: 0.0625,
    metadata: { output_action: "accepted", outcome: "resolved", document_type: "receipt" },
  },
  {
    trace: "app_before",
    day: -2,
    origin: "application",
    topic: TOPIC_ONE,
    cost: 0.25,
    metadata: { topic: "billing" },
  },
  {
    trace: "chat_1",
    day: 1.5,
    origin: "langy",
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
    origin: "langy",
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
    origin: "langy",
    topic: TOPIC_TWO,
    cost: 0.125,
    metadata: { topic: "refunds" },
  },
  {
    trace: "sim_1",
    day: 2,
    origin: "simulation",
    customer: "acme",
    cost: 1,
    metadata: { output_action: "accepted", outcome: "handover", document_type: "invoice" },
  },
  {
    trace: "no_row",
    day: 3,
    origin: null,
    customer: "initech",
    cost: 1,
    metadata: { output_action: "accepted", outcome: "handover", document_type: "invoice" },
  },
];

const timeOf = (seed: Seed) => PERIOD_START + seed.day * DAY;

/** The trace-level attributes both fact tables carry for a seed. */
function attributesOf(seed: Seed): Record<string, string> {
  const attributes: Record<string, string> = Object.fromEntries(
    Object.entries(seed.metadata).map(([key, value]) => [`metadata.${key}`, value]),
  );
  if (seed.customer) attributes["langwatch.customer_id"] = seed.customer;
  if (seed.labels) attributes["langwatch.labels"] = JSON.stringify(seed.labels);
  if (seed.thread) attributes["langwatch.thread.id"] = seed.thread;
  return attributes;
}

/** A `trace_analytics` row; ClickHouse derives its Metadata* columns from `Attributes`. */
function analyticsRow(seed: Seed, occurredAt = timeOf(seed)): Record<string, unknown> {
  return {
    TenantId: TENANT,
    TraceId: seed.trace,
    Version: "1",
    OccurredAt: at(occurredAt),
    CreatedAt: at(timeOf(seed)),
    UpdatedAt: at(timeOf(seed)),
    TraceName: seed.trace,
    TopicId: seed.topic ?? null,
    ConversationId: seed.thread ?? null,
    CustomerId: seed.customer ?? null,
    Origin: seed.origin ?? "",
    Models: ["gpt-5"],
    Labels: seed.labels ?? [],
    TotalCost: seed.cost,
    TotalDurationMs: 1200,
    HasError: false,
    Attributes: attributesOf(seed),
  };
}

function summaryRow(seed: Seed): Record<string, unknown> {
  return {
    ProjectionId: `${TENANT}/${seed.trace}`,
    TenantId: TENANT,
    TraceId: seed.trace,
    Version: "1",
    OccurredAt: at(timeOf(seed)),
    UpdatedAt: at(timeOf(seed)),
    TraceName: seed.trace,
    TotalDurationMs: 1200,
    Models: ["gpt-5"],
    TotalCost: seed.cost,
    TopicId: seed.topic ?? null,
    Attributes: attributesOf(seed),
  };
}

describe("given traces of each source carrying the metadata the widgets read", () => {
  let harness: LangWatchQLClickHouseHarness;
  let postgres: LangWatchQLPostgresHarness;
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
      });
      const rows = (await result.json<Record<string, unknown>>()).map((row) => JSON.stringify(row));
      return { rows: JSON.stringify(rows.toSorted()) };
    } catch (error) {
      return { error: error instanceof Error ? error.message.slice(0, 600) : String(error) };
    }
  }

  /** The moved queries, or the `only` ones, whose rows differ from their `traces` form. */
  async function differing({
    list,
    only,
  }: {
    list: readonly string[];
    only?: readonly string[];
  }): Promise<string[]> {
    const labels: string[] = [];
    for (const { label, sql } of BASELINE.filter((query) => only?.includes(query.label) ?? true)) {
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
    // `topics` is PostgreSQL-resident, so the moved topic queries need the mapped engine tables.
    postgres = await startLangWatchQLPostgres();
    harness = await startLangWatchQLClickHouse({ suite: "trace-metrics-rows", facts: "migrated" });
    const { names, factDatabase: facts } = harness;
    await mapPostgresIntoClickHouse({ harness, postgres });
    await harness.applyAsAdmin(
      viewProvisioning.setupStatements({ names, sourceDatabase: facts, dedup: SHIPPED_LWQL_DEDUP }),
    );
    await harness.applyAccessModel({ views: LWQL_VIEW_CATALOG, sourceDatabase: facts });

    await harness.admin.insert({
      table: `${facts}.trace_summaries`,
      format: "JSONEachRow",
      values: SEEDS.map(summaryRow),
    });
    await harness.admin.insert({
      table: `${facts}.trace_analytics`,
      format: "JSONEachRow",
      values: SEEDS.flatMap((seed) => (seed.origin === null ? [] : [analyticsRow(seed)])),
    });

    // Unqualified view names, as the stored widget queries write them.
    client = createClient({
      ...harness.restrictedConnection(),
      database: names.database,
      clickhouse_settings: { [names.tenantSetting]: harness.tenantA.keyHash },
    });
    await expectRestrictedIdentity({ client, names });
  }, 600_000);

  afterAll(async () => {
    await client?.close();
    await harness?.stop();
    await postgres?.stop();
  });

  /** @scenario "A moved widget query returns the rows its traces form returned" */
  it.each(LISTS)("returns each moved query's traces rows under $list", async ({ list }) => {
    expect(BASELINE).toHaveLength(14);
    expect(await differing({ list })).toEqual([]);
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

  /** @scenario "A trace with two trace_metrics rows adds its cost once to the summed widgets" */
  it("returns the same rows when a trace has two rows in trace_metrics", async () => {
    const [first] = SEEDS;
    if (!first) throw new Error("no seed");
    // A row written before the storage anchor froze, whose OccurredAt later moved (ADR-082).
    await harness.admin.insert({
      table: `${harness.factDatabase}.trace_analytics`,
      format: "JSONEachRow",
      values: [analyticsRow(first, timeOf(first) + 3_600_000)],
    });

    expect(await differing({ list: ["application"] })).toEqual([]);
    expect(await differing({ list: ["langy"] })).toEqual([]);
  });

  /** Writes a second `trace_analytics` row for `trace`, `days` after its first. */
  async function moveAnchor({ trace, days }: { trace: string; days: number }): Promise<void> {
    const seed = SEEDS.find((candidate) => candidate.trace === trace);
    if (!seed) throw new Error(`no seed ${trace}`);
    await harness.admin.insert({
      table: `${harness.factDatabase}.trace_analytics`,
      format: "JSONEachRow",
      values: [analyticsRow(seed, timeOf(seed) + days * DAY)],
    });
  }

  /** @scenario "A second trace_metrics row in another bucket or half counts the trace once" */
  it("counts a trace once when its second row lands in another bucket and half", async () => {
    // app_2 starts on day 2. Day 3.75 is past the day-3 bucket edge (buckets are whole days)
    // and past MIDPOINT (day 3.5): the bucket queries would count it on day 2 and day 3.
    await moveAnchor({ trace: "app_2", days: 1.75 });

    expect(await differing({ list: ["application"] })).toEqual([]);
    expect(await differing({ list: ["langy"] })).toEqual([]);
  });

  /** @scenario "A second trace_metrics row past the period start keeps the trace before it" */
  it("keeps a trace that began before the period out of it", async () => {
    // app_before and chat_before start on days -2 and -1. Day 0.5 is past the period start, so
    // the rows would count each trace in in_previous and in_period, and in the period's buckets.
    // The filtered queries keep the trace out; the others still count the inside row (window edge).
    await moveAnchor({ trace: "app_before", days: 2.5 });
    await moveAnchor({ trace: "chat_before", days: 1.5 });

    for (const { list } of LISTS) {
      expect(await differing({ list, only: SPLITS }), list.join()).toEqual([]);
    }
    expect(FILTERED).toEqual(expect.arrayContaining(SPLITS));
    // Under langy nothing differed before this move, so any difference here is the inside row.
    const moved = BASELINE.map(({ label }) => label);
    const unguarded = moved.filter((label) => !FILTERED.includes(label));
    expect(await differing({ list: ["langy"], only: unguarded })).not.toEqual([]);
  });

  /** @scenario "A conversation in two units counts once in each unit's share" */
  it("totals conversations as the sum of the per-unit conversations", async () => {
    const [first] = SEEDS;
    if (!first) throw new Error("no seed");
    // thread_1 is acme's; this trace puts it under globex too, so it is a conversation of both.
    await harness.admin.insert({
      table: `${harness.factDatabase}.trace_analytics`,
      format: "JSONEachRow",
      values: [
        analyticsRow({
          ...first,
          trace: "app_globex_thread",
          customer: "globex",
          day: 3,
          labels: [],
        }),
      ],
    });

    const list = ["application"];
    const perUnit = await rowsOf({ sql: STOCK.get("att-share/units") ?? "", list });
    const summed = perUnit.reduce((sum, row) => sum + Number(row.conversations), 0);
    expect(perUnit.map((row) => row.unit)).toEqual(expect.arrayContaining(["acme", "globex"]));

    // Both widgets read one totals query; its conversations are the share denominator.
    for (const totals of ["att-share/totals", "cost-by-segment/totals"]) {
      const [total] = await rowsOf({ sql: STOCK.get(totals) ?? "", list });
      expect(Number(total?.conversations), totals).toBe(summed);
    }
  });

  /** @scenario "att-table's pass rates group traces by the units its volumes list" */
  it("groups att-table's pass rates by the units its volumes list", async () => {
    const [first] = SEEDS;
    if (!first) throw new Error("no seed");
    // A unit only trace_metrics carries: a pass rate that picked units from traces would miss it.
    const umbrella: Seed = { ...first, trace: "app_umbrella", customer: "umbrella", day: 4 };
    await harness.admin.insert({
      table: `${harness.factDatabase}.trace_analytics`,
      format: "JSONEachRow",
      values: [analyticsRow(umbrella)],
    });
    const judged = [...SEEDS.filter((seed) => seed.origin !== null), umbrella];
    await harness.admin.insert({
      table: `${harness.factDatabase}.evaluation_analytics`,
      format: "JSONEachRow",
      values: judged.map(evaluationRow),
    });

    const list = ["application"];
    const units = await rowsOf({ sql: STOCK.get("att-table/units") ?? "", list });
    const passRates = await rowsOf({ sql: STOCK.get("att-table/passRates") ?? "", list });
    const inPeriod = passRates.filter((row) => Number(row.judged) > 0);

    expect(units.map((row) => row.unit)).toContain("umbrella");
    expect(inPeriod.map((row) => String(row.unit)).toSorted()).toEqual(
      units.map((row) => String(row.unit)).toSorted(),
    );
  });

  /** A passed judge verdict on `seed`, stamped when its trace began, from its trace's origin. */
  function evaluationRow(seed: Seed): Record<string, unknown> {
    return {
      TenantId: TENANT,
      EvaluationId: `${seed.trace}-judge`,
      Version: "1",
      OccurredAt: at(timeOf(seed)),
      CreatedAt: at(timeOf(seed)),
      UpdatedAt: at(timeOf(seed)),
      EvaluatorType: "llm_judge",
      EvaluatorName: "Quality",
      Status: "processed",
      IsGuardrail: false,
      Passed: true,
      Score: 1,
      TraceId: seed.trace,
      Origin: seed.origin ?? "",
    };
  }

  /** The query's rows as ClickHouse returns them. */
  async function rowsOf({
    sql,
    list,
  }: {
    sql: string;
    list: readonly string[];
  }): Promise<Record<string, unknown>[]> {
    const result = await client.query({
      query: sql,
      query_params: { ...PARAMETERS, dashboard_context_sources: list },
      format: "JSONEachRow",
    });
    return result.json<Record<string, unknown>>();
  }
});
