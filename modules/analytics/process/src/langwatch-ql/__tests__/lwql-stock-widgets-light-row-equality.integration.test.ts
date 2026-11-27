/**
 * @vitest-environment node
 * Every stock query, on the shipped views, returns the rows main's form returned on the FINAL
 * views; the 39 that ran out of memory now read typed columns and hash only their small side.
 * @see specs/lwql/stock-widgets-read-no-map.feature
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { LangWatchQLViewProvisioningService } from "../../features/provisioning/services/langwatch-ql-view-provisioning.service.ts";
import { SHIPPED_LWQL_DEDUP } from "../../features/provisioning/services/langwatch-ql-view-statements.service.ts";
import { floorLangWatchQLDedup } from "../../rules/lwql-dedup-floor.rules.ts";
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
import { provisionFinalTwins, readingFinalTwins } from "./lwql-final-twins.ts";

const viewProvisioning = LangWatchQLViewProvisioningService.create();

const LISTS = [{ list: ["application"] }, { list: ["langy"] }];

type StockQuery = { label: string; sql: string };

function fixture(name: string): readonly StockQuery[] {
  return JSON.parse(
    readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8"),
  );
}

/** Main's SQL for every stock query, as the catalogue stored it before the rewrite. */
const MAIN = fixture("stock-widget-queries.main.json");
const STOCK = new Map(fixture("stock-widget-queries.json").map((q) => [q.label, q.sql]));
/**
 * Main capped its loops and its retries at 10000 rows each with no ORDER BY, so which rows it kept
 * was arbitrary; the shipped form drops the cap on purpose, so it is compared with main's uncapped.
 */
const UNCAPPED = new Set(["up-loops/daily", "up-loops/steps"]);
const MAIN_CAP = "\n  LIMIT 10000";

/** Main's form of a stock query, as the rows are compared with it. */
const mainForm = ({ label, sql }: StockQuery): string =>
  UNCAPPED.has(label) ? sql.replaceAll(MAIN_CAP, "") : sql;

/** The 39 labels that ran out of memory: main's SQL for each differs from the rewrite. */
const REWRITTEN = fixture("stock-widget-queries.light-baseline.json").map((q) => q.label);
/**
 * The labels that read `trace_evaluation_analytics`, which this suite does not seed: their rows
 * are proved in lwql-trace-evaluations-row-equality.integration.test.ts.
 */
const ON_TRACE_EVALUATIONS = new Set(
  fixture("stock-widget-queries.trace-evaluations-baseline.json").map((q) => q.label),
);

/** The per-minute rollups, which keep no origin, so main's form over them counted every source. */
const ROLLUP_VIEWS = ["model_usage_by_minute", "trace_metrics_by_minute"];
const ROLLUP_READ = new RegExp(
  `\\b(FROM|JOIN)(\\s+)(?:analytics\\.)?(${ROLLUP_VIEWS.join("|")})\\b(?!\\.)`,
  "gi",
);
const readsRollup = (sql: string) => new RegExp(ROLLUP_READ.source, "i").test(sql);
/**
 * Main's queries over the rollups, which now read trace_metrics and keep to the list
 * (specs/lwql/stock-widgets-keep-to-sources.feature): compared over a rollup of the list's traces.
 */
const OFF_ROLLUPS = new Set(
  fixture("stock-widget-queries.json")
    .filter(
      ({ label, sql }) =>
        !readsRollup(sql) && MAIN.some((q) => q.label === label && readsRollup(q.sql)),
    )
    .map(({ label }) => label),
);

/** The SQL with every read of a per-minute rollup pointed at `database`'s copy. */
const readingRollup = ({ sql, database }: { sql: string; database: string }): string =>
  sql.replace(ROLLUP_READ, (_match, keyword: string, space: string, view: string) =>
    [keyword, space, `${database}.${view}`].join(""),
  );

/** The queries the keep-to-sources change moved, listed so a new rollup reader is noticed. */
const MOVED_OFF_ROLLUPS = [
  "cost-by-model/models",
  "fd-cost-efficiency/models",
  "ship-rollout/changes",
  "ship-rollout/checks",
  "ship-rollout/traffic",
  "token-drift/main",
  "tools-wrong-tool/changes",
  "top-models/modelCosts",
  "up-errors/changes",
  "up-loops/totals",
];
/** Those whose rows over every source differ from the list's; the rest find no change anyway. */
const COUNTED_EVERY_SOURCE = [
  "cost-by-model/models",
  "fd-cost-efficiency/models",
  "token-drift/main",
  "top-models/modelCosts",
  "up-loops/totals",
];

/** The queries that date a closed trace by its first row inside the window (analytics ADR-004). */
const IN_WINDOW_DATED = [
  "ans-idk/topics",
  "ans-idk/trend",
  "ans-outcomes/trend",
  "ask-again/trend",
  "ask-cannot/totals",
  "ck-trend/trend",
  "voice-task-success/trend",
];

const TENANT = TENANT_A.tenantId;
const TOPIC_ONE = `${TENANT}-topic-1`;
const TOPIC_TWO = `${TENANT}-topic-2`;

const DAY = 86_400_000;
const PERIOD_END = Math.floor(Date.now() / DAY) * DAY;
const PERIOD_START = PERIOD_END - 7 * DAY;

/** A DateTime literal with no fraction, which a `DateTime` parameter and column both parse. */
const at = (time: number) => new Date(time).toISOString().slice(0, 19).replace("T", " ");
const onDay = (day: number) => at(PERIOD_START + day * DAY);
const PARAMETERS = {
  dashboard_context_period_start: at(PERIOD_START),
  dashboard_context_period_end: at(PERIOD_END),
  dashboard_context_granularity_seconds: 86_400,
};

type TraceSeed = {
  trace: string;
  day: number;
  origin: string;
  metadata: Record<string, string>;
  customer?: string;
  labels?: string[];
  topic?: string;
  promptVersion?: string;
};

/** Every metadata key the 39 queries read, spread over sources, windows and a 40-day-old trace. */
const TRACES: TraceSeed[] = [
  {
    trace: "a1",
    day: 1,
    origin: "application",
    customer: "acme",
    labels: ["vip"],
    topic: TOPIC_ONE,
    metadata: { outcome: "resolved", topic: "billing", language: "en", prompt_version: "m1" },
  },
  {
    trace: "a2",
    day: 2,
    origin: "application",
    customer: "acme",
    promptVersion: "pv-2",
    metadata: {
      outcome: "capability_gap",
      outcome_reason: "no refunds",
      topic: "refunds",
      language: "nl",
    },
  },
  {
    trace: "a3",
    day: 3.5,
    origin: "application",
    customer: "globex",
    labels: ["beta"],
    topic: TOPIC_TWO,
    promptVersion: "pv-2",
    metadata: { outcome: "refusal", outcome_reason: "policy", environment: "staging" },
  },
  {
    trace: "a4",
    day: 4,
    origin: "",
    customer: "globex",
    metadata: { document_type: "invoice", env: "dev" },
  },
  {
    trace: "a5",
    day: 5,
    origin: "application",
    labels: ["test"],
    promptVersion: "pv-3",
    metadata: {},
  },
  {
    trace: "a6",
    day: 2.5,
    origin: "application",
    customer: "initech",
    promptVersion: "pv-1",
    metadata: { prompt_version: "m2", team: "support" },
  },
  {
    trace: "before1",
    day: -2,
    origin: "application",
    customer: "acme",
    topic: TOPIC_ONE,
    promptVersion: "pv-1",
    metadata: { outcome: "misunderstood", outcome_reason: "unclear", topic: "billing" },
  },
  { trace: "before2", day: -3, origin: "application", metadata: { prompt_version: "m1" } },
  { trace: "old", day: -40, origin: "application", promptVersion: "pv-0", metadata: {} },
  {
    trace: "l1",
    day: 1.5,
    origin: "langy",
    promptVersion: "pv-9",
    metadata: { outcome: "handover", outcome_reason: "human", language: "de" },
  },
  {
    trace: "l2",
    day: 3,
    origin: "langy",
    topic: TOPIC_TWO,
    metadata: { outcome: "capability_gap", outcome_reason: "no stock" },
  },
  {
    trace: "s1",
    day: 2,
    origin: "simulation",
    customer: "acme",
    metadata: { outcome: "resolved" },
  },
];

/** The source a trace counts under: a missing or empty origin counts as application. */
const sourceOf = (seed: TraceSeed) => seed.origin || "application";

/** Every trace's tokens, which trace_analytics and the rollup both carry. */
const PROMPT_TOKENS = 40;
const COMPLETION_TOKENS = 8;

/** A one-span trace's `trace_analytics_rollup` row, as the fold writes it, on the trace's day. */
function rollupRow(seed: TraceSeed): Record<string, unknown> {
  return {
    TenantId: TENANT,
    BucketStart: onDay(seed.day),
    Model: seed.day > 0 ? "gpt-5" : "gpt-4",
    SpanType: "llm",
    SpanCount: 1,
    TraceCount: 1,
    ErrorCount: 0,
    CostSum: 0.5,
    NonBilledCostSum: 0,
    DurationSum: 1000,
    PromptTokensSum: PROMPT_TOKENS,
    CompletionTokensSum: COMPLETION_TOKENS,
    CacheReadTokensSum: 0,
    CacheWriteTokensSum: 0,
    ReasoningTokensSum: 0,
  };
}

const dayOf = (trace: string) => TRACES.find((seed) => seed.trace === trace)?.day ?? 0;
const originOf = (trace: string) => TRACES.find((seed) => seed.trace === trace)?.origin ?? "";

function attributesOf(seed: TraceSeed): Record<string, string> {
  const attributes: Record<string, string> = Object.fromEntries(
    Object.entries(seed.metadata).map(([key, value]) => [`metadata.${key}`, value]),
  );
  if (seed.customer) attributes["langwatch.customer_id"] = seed.customer;
  if (seed.labels) attributes["langwatch.labels"] = JSON.stringify(seed.labels);
  if (seed.origin) attributes["langwatch.origin"] = seed.origin;
  return attributes;
}

/**
 * A `trace_analytics` row. The goose 00126 columns are MATERIALIZED from `Attributes`; the
 * goose 00128 and 00133 ones are the fold's to write, so the row carries them as the fold does.
 */
function analyticsRow(seed: TraceSeed, day = seed.day): Record<string, unknown> {
  return {
    MetadataOutcomeReason: seed.metadata.outcome_reason ?? "",
    MetadataPromptVersion: seed.metadata.prompt_version ?? "",
    MetadataEnvironment: seed.metadata.environment || seed.metadata.env || "",
    LastUsedPromptVersionId: seed.promptVersion ?? "",
    TenantId: TENANT,
    TraceId: seed.trace,
    Version: "1",
    OccurredAt: onDay(day),
    CreatedAt: onDay(seed.day),
    UpdatedAt: onDay(seed.day),
    TraceName: seed.trace,
    TopicId: seed.topic ?? null,
    CustomerId: seed.customer ?? null,
    Origin: seed.origin,
    Models: [seed.day > 0 ? "gpt-5" : "gpt-4"],
    Labels: seed.labels ?? [],
    TotalCost: 0.5,
    PromptTokens: PROMPT_TOKENS,
    CompletionTokens: COMPLETION_TOKENS,
    TotalDurationMs: 1000,
    HasError: false,
    Attributes: attributesOf(seed),
  };
}

function summaryRow(seed: TraceSeed): Record<string, unknown> {
  return {
    ProjectionId: `${TENANT}/${seed.trace}`,
    TenantId: TENANT,
    TraceId: seed.trace,
    Version: "1",
    OccurredAt: onDay(seed.day),
    CreatedAt: onDay(seed.day),
    UpdatedAt: onDay(seed.day),
    TraceName: seed.trace,
    TotalDurationMs: 1000,
    Models: ["gpt-5"],
    TotalCost: 0.5,
    TopicId: seed.topic ?? null,
    Attributes: attributesOf(seed),
    ComputedInput: `input of ${seed.trace}`,
    LastUsedPromptVersionId: seed.promptVersion ?? null,
  };
}

/** Outcome judge verdicts (`evaluations` and `evaluation_metrics`), checks and field checks. */
const JUDGED = [
  { trace: "a5", label: "resolved", details: "fine" },
  { trace: "a6", label: "capability_gap", details: "cannot book" },
  { trace: "a1", label: "refusal", details: "judge disagrees" },
  { trace: "before2", label: "refusal", details: "old refusal" },
  { trace: "l1", label: "misunderstood", details: "langy judge" },
];
const CHECKS = [
  { trace: "a1", passed: true, name: "Quality" },
  { trace: "a1", passed: false, name: "Tone" },
  { trace: "a2", passed: true, name: "Quality" },
  { trace: "a3", passed: false, name: "Quality" },
  { trace: "a4", passed: true, name: "Quality" },
  { trace: "before1", passed: true, name: "Quality" },
  { trace: "l1", passed: true, name: "Quality" },
  { trace: "a6", passed: true, name: "Guard" },
];
const FIELD_CHECKS = [
  { trace: "a4", details: "Wrong: total, date" },
  { trace: "a1", details: "All right" },
  { trace: "a2", details: "Wrong: total" },
];

function evaluationRunRow({
  id,
  trace,
  name,
  label = null,
  details,
}: {
  id: string;
  trace: string;
  name: string;
  label?: string | null;
  details: string;
}): Record<string, unknown> {
  const scheduled = onDay(dayOf(trace) + 0.1);
  return {
    ProjectionId: id,
    TenantId: TENANT,
    EvaluationId: id,
    Version: "1",
    EvaluatorId: name,
    EvaluatorType: "llm",
    EvaluatorName: name,
    TraceId: trace,
    IsGuardrail: 0,
    Status: "processed",
    Label: label,
    Details: details,
    CreatedAt: scheduled,
    UpdatedAt: scheduled,
    ScheduledAt: scheduled,
    LastEventOccurredAt: scheduled,
  };
}

function evaluationAnalyticsRow({
  id,
  trace,
  name,
  label = null,
  passed = null,
}: {
  id: string;
  trace: string;
  name: string;
  label?: string | null;
  passed?: boolean | null;
}): Record<string, unknown> {
  return {
    TenantId: TENANT,
    EvaluationId: id,
    Version: "1",
    OccurredAt: onDay(dayOf(trace) + 0.2),
    CreatedAt: onDay(dayOf(trace)),
    UpdatedAt: onDay(dayOf(trace)),
    EvaluatorType: "llm",
    EvaluatorName: name,
    Status: "processed",
    IsGuardrail: name === "Guard",
    Passed: passed,
    Label: label,
    TraceId: trace,
    Origin: originOf(trace),
  };
}

type SpanSeed = {
  trace: string;
  span: string;
  parent: string | null;
  name: string;
  offset: number;
  status?: number;
  type?: string;
  attributes?: Record<string, string>;
  resource?: Record<string, string>;
  cost?: number;
  durationMs?: number;
};

/** Loops, retries, failures with and without a recovering parent, rag, voice and environments. */
const SPANS: SpanSeed[] = [
  {
    trace: "a1",
    span: "r",
    parent: null,
    name: "agent",
    offset: 0,
    status: 1,
    resource: { "deployment.environment": "Staging" },
    cost: 0.1,
  },
  ...[1, 2, 3].map((n) => ({
    trace: "a1",
    span: `t${n}`,
    parent: "r",
    name: "search",
    offset: 0.0001 * n,
    type: "tool",
    attributes: { "langwatch.input": "same" },
    cost: 0.01,
  })),
  {
    trace: "a1",
    span: "l1",
    parent: "r",
    name: "chat",
    offset: 0.001,
    status: 2,
    type: "llm",
    attributes: { "exception.type": "RateLimit" },
    cost: 0.02,
  },
  {
    trace: "a1",
    span: "l2",
    parent: "r",
    name: "chat",
    offset: 0.002,
    status: 1,
    type: "llm",
    cost: 0.03,
  },
  {
    trace: "a2",
    span: "r",
    parent: null,
    name: "agent",
    offset: 0,
    status: 2,
    attributes: { "error.type": "500" },
  },
  {
    trace: "a2",
    span: "t",
    parent: "r",
    name: "lookup",
    offset: 0.0001,
    status: 2,
    type: "tool",
    attributes: { "exception.type": "Timeout" },
  },
  {
    trace: "a2",
    span: "g",
    parent: "r",
    name: "retrieve",
    offset: 0.0002,
    type: "rag",
    attributes: { "langwatch.rag.contexts": "[]" },
  },
  { trace: "a3", span: "r", parent: null, name: "call", offset: 0, status: 1 },
  {
    trace: "a3",
    span: "g",
    parent: "r",
    name: "retrieve",
    offset: 0.0001,
    type: "rag",
    attributes: { "langwatch.rag.contexts": '[{"c":1},{"c":2}]' },
  },
  { trace: "a3", span: "stt", parent: "r", name: "stt", offset: 0.0002, durationMs: 300 },
  {
    trace: "a3",
    span: "llm",
    parent: "r",
    name: "think",
    offset: 0.0003,
    type: "llm",
    durationMs: 500,
  },
  { trace: "a3", span: "tts", parent: "r", name: "tts", offset: 0.0004, durationMs: 200 },
  {
    trace: "a4",
    span: "only",
    parent: null,
    name: "calc",
    offset: 0,
    status: 2,
    type: "tool",
    resource: { "deployment.environment.name": "dev" },
    cost: 0.2,
  },
  { trace: "l1", span: "r", parent: null, name: "agent", offset: 0, status: 2 },
  {
    trace: "l1",
    span: "t",
    parent: "r",
    name: "lookup",
    offset: 0.0001,
    status: 2,
    type: "tool",
    attributes: { "exception.type": "Timeout" },
  },
  { trace: "s1", span: "r", parent: null, name: "agent", offset: 0 },
  { trace: "s1", span: "g", parent: "r", name: "retrieve", offset: 0.0001, type: "rag" },
];

function spanRow(seed: SpanSeed): Record<string, unknown> {
  const start = PERIOD_START + (dayOf(seed.trace) + seed.offset) * DAY;
  return {
    ProjectionId: `${TENANT}/${seed.trace}/${seed.span}`,
    TenantId: TENANT,
    TraceId: seed.trace,
    SpanId: seed.span,
    ParentSpanId: seed.parent,
    StartTime: at(start),
    EndTime: at(start + 1000),
    DurationMs: seed.durationMs ?? 100,
    SpanName: seed.name,
    SpanAttributes: {
      ...seed.attributes,
      ...(seed.type ? { "langwatch.span.type": seed.type } : {}),
    },
    ResourceAttributes: seed.resource ?? {},
    StatusCode: seed.status ?? null,
    Cost: seed.cost ?? null,
    CreatedAt: at(start),
    UpdatedAt: at(start),
  };
}

/** The `span_analytics` row the trace module's span projection writes for `seed`. */
function spanAnalyticsRow(seed: SpanSeed): Record<string, unknown> {
  const start = PERIOD_START + (dayOf(seed.trace) + seed.offset) * DAY;
  const attributes = seed.attributes ?? {};
  const resource = seed.resource ?? {};
  const input = attributes["langwatch.input"] ?? "";
  const contexts = attributes["langwatch.rag.contexts"];
  return {
    TenantId: TENANT,
    TraceId: seed.trace,
    SpanId: seed.span,
    ParentSpanId: seed.parent,
    StartTime: at(start),
    EndTime: at(start + 1000),
    DurationMs: seed.durationMs ?? 100,
    SpanName: seed.name,
    SpanKind: 0,
    StatusCode: seed.status ?? null,
    Cost: seed.cost ?? null,
    NonBilledCost: null,
    SpanType: seed.type ?? "",
    ErrorType: attributes["exception.type"] || attributes["error.type"] || "",
    RagContextCount: contexts ? (JSON.parse(contexts) as unknown[]).length : 0,
    InputHash: input
      ? createHash("sha256").update(input).digest().readBigUInt64BE(0).toString()
      : "0",
    DeploymentEnvironment:
      resource["deployment.environment"] || resource["deployment.environment.name"] || "",
    ProjectedAt: at(start),
  };
}

describe("given traces, spans and evaluations of each source that the stock queries read", () => {
  let harness: LangWatchQLClickHouseHarness;
  let postgres: LangWatchQLPostgresHarness;
  let client: ClickHouseClient;
  let finalTwins: string;
  /** Per list, the database whose rollup views read only that list's traces. */
  const listRollups = new Map<string, string>();

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

  /** Main's form on the FINAL views, its rollup reads kept to `list`'s traces. */
  function mainOver({
    query,
    list,
    rollup = listRollups.get(list.join()) ?? "",
  }: {
    query: StockQuery;
    list: readonly string[];
    rollup?: string;
  }): string {
    const sql = readingFinalTwins({ sql: mainForm(query), database: finalTwins });
    return OFF_ROLLUPS.has(query.label) ? readingRollup({ sql, database: rollup }) : sql;
  }

  /** A database whose rollup views read a rollup table holding only `list`'s traces. */
  async function provisionListRollup(list: readonly string[]): Promise<string> {
    const { names, factDatabase } = harness;
    const database = `${names.database}_rollup_${list.join("_")}`;
    await harness.applyAsAdmin([
      `DROP DATABASE IF EXISTS ${database}`,
      `CREATE DATABASE ${database}`,
      `CREATE TABLE ${database}.trace_analytics_rollup AS ${factDatabase}.trace_analytics_rollup`,
      ...viewProvisioning.setupStatements({
        names: { ...names, database },
        sourceDatabase: database,
        views: LWQL_VIEW_CATALOG.filter((view) => ROLLUP_VIEWS.includes(view.name)),
        dedup: SHIPPED_LWQL_DEDUP,
      }),
      `GRANT SELECT ON ${database}.* TO ${names.restrictedUser}`,
    ]);
    await harness.admin.insert({
      table: `${database}.trace_analytics_rollup`,
      format: "JSONEachRow",
      values: TRACES.filter((seed) => list.includes(sourceOf(seed))).map(rollupRow),
    });
    return database;
  }

  /** The labels whose rows differ from main's form on the FINAL views; every query must run. */
  async function differing(list: readonly string[]): Promise<string[]> {
    const labels: string[] = [];
    for (const query of MAIN.filter(({ label }) => !ON_TRACE_EVALUATIONS.has(label))) {
      const { label } = query;
      const now = await run({ sql: STOCK.get(label) ?? "", list });
      const before = await run({ sql: mainOver({ query, list }), list });
      expect(now.error, `${label} now`).toBeUndefined();
      expect(before.error, `${label} before`).toBeUndefined();
      if (now.rows !== before.rows) labels.push(label);
    }
    return labels;
  }

  beforeAll(async () => {
    postgres = await startLangWatchQLPostgres();
    harness = await startLangWatchQLClickHouse({ suite: "stock-widgets-light", facts: "migrated" });
    const { names, factDatabase: facts } = harness;
    await mapPostgresIntoClickHouse({ harness, postgres });
    await harness.applyAsAdmin(
      viewProvisioning.setupStatements({ names, sourceDatabase: facts, dedup: SHIPPED_LWQL_DEDUP }),
    );
    await harness.applyAccessModel({ views: LWQL_VIEW_CATALOG, sourceDatabase: facts });
    finalTwins = await provisionFinalTwins({ harness });
    for (const { list } of LISTS) listRollups.set(list.join(), await provisionListRollup(list));

    const inserts: [string, Record<string, unknown>[]][] = [
      ["trace_summaries", TRACES.map(summaryRow)],
      ["trace_analytics", TRACES.map((seed) => analyticsRow(seed))],
      ["stored_spans", SPANS.map(spanRow)],
      ["span_analytics", SPANS.map(spanAnalyticsRow)],
      [
        "evaluation_runs",
        [
          ...JUDGED.map(({ trace, label, details }, n) =>
            evaluationRunRow({
              id: `judge-${n}`,
              trace,
              name: "Conversation Outcome Judge",
              label,
              details,
            }),
          ),
          ...FIELD_CHECKS.map(({ trace, details }, n) =>
            evaluationRunRow({
              id: `field-${n}`,
              trace,
              name: "Field accuracy per field",
              details,
            }),
          ),
        ],
      ],
      [
        "evaluation_analytics",
        [
          ...JUDGED.map(({ trace, label }, n) =>
            evaluationAnalyticsRow({
              id: `judge-${n}`,
              trace,
              name: "Conversation Outcome Judge",
              label,
            }),
          ),
          ...CHECKS.map(({ trace, passed, name }, n) =>
            evaluationAnalyticsRow({ id: `check-${n}`, trace, name, passed }),
          ),
        ],
      ],
    ];
    for (const [table, values] of inserts) {
      await harness.admin.insert({ table: `${facts}.${table}`, format: "JSONEachRow", values });
    }

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

  /**
   * Writes a second `trace_analytics` row for `trace`, as a pre-freeze row whose anchor moved:
   * an older write, so the seeded row stays the trace's newest, as `traces` keeps it.
   */
  async function moveAnchor({ trace, day }: { trace: string; day: number }): Promise<void> {
    const seed = TRACES.find((candidate) => candidate.trace === trace);
    if (!seed) throw new Error(`no seed ${trace}`);
    await harness.admin.insert({
      table: `${harness.factDatabase}.trace_analytics`,
      format: "JSONEachRow",
      values: [{ ...analyticsRow(seed, day), UpdatedAt: onDay(seed.day - 0.5) }],
    });
  }

  /** One fold write of `seed` to both trace tables, anchored on its day, written on `updated`. */
  async function writeTrace({ seed, updated }: { seed: TraceSeed; updated: number }) {
    const facts = harness.factDatabase;
    await harness.admin.insert({
      table: `${facts}.trace_summaries`,
      format: "JSONEachRow",
      values: [{ ...summaryRow(seed), UpdatedAt: onDay(updated) }],
    });
    await harness.admin.insert({
      table: `${facts}.trace_analytics`,
      format: "JSONEachRow",
      values: [{ ...analyticsRow(seed), UpdatedAt: onDay(updated) }],
    });
  }

  type ChangeRow = { version: string; changed_at: string; previous: string };
  const CHANGE = "att-change/change";

  /** att-change/change as written, as the executor sends it (floored), and main's form. */
  function changeForms(): { written: string; floored: string; main: string } {
    const written = STOCK.get(CHANGE) ?? "";
    const floored = floorLangWatchQLDedup({
      sql: written,
      database: harness.names.database,
      views: LWQL_VIEW_CATALOG,
    });
    expect(floored).toContain("trace_metrics__floor(lwql_floor = ");
    const main = MAIN.find((query) => query.label === CHANGE);
    if (!main) throw new Error(`no main form of ${CHANGE}`);
    return {
      written,
      floored,
      main: readingFinalTwins({ sql: mainForm(main), database: finalTwins }),
    };
  }

  async function changeRows({ sql, list }: { sql: string; list: readonly string[] }) {
    const result = await client.query({
      query: sql,
      query_params: { ...PARAMETERS, dashboard_context_sources: list },
      format: "JSONEachRow",
    });
    return result.json<ChangeRow>();
  }

  /** att-change/change, written and floored, returns main's rows under each list. */
  async function expectChangeMatchesMain(): Promise<void> {
    const forms = changeForms();
    for (const { list } of LISTS) {
      const before = await run({ sql: forms.main, list });
      expect(before.error, `main under ${list.join()}`).toBeUndefined();
      for (const sql of [forms.written, forms.floored]) {
        const now = await run({ sql, list });
        expect(now.error, `now under ${list.join()}`).toBeUndefined();
        expect(now.rows, `against main under ${list.join()}`).toBe(before.rows);
      }
    }
  }

  /** @scenario "Each of the 39 rewritten stock queries returns the rows main's form returned" */
  it.each(LISTS)("returns main's rows for every query under $list", async ({ list }) => {
    expect(MAIN.map(({ label }) => label).toSorted()).toEqual([...STOCK.keys()].toSorted());
    expect(REWRITTEN).toHaveLength(39);
    expect(await differing(list)).toEqual([]);
  });

  /** @scenario "The queries moved off the rollups return main's rows over the list's own traces" */
  it("compares the queries moved off the rollups over a rollup of every source too", async () => {
    expect([...OFF_ROLLUPS].toSorted()).toEqual(MOVED_OFF_ROLLUPS);
    const everySource = await provisionListRollup(["application", "langy", "simulation"]);
    const list = ["application"];
    const compared = await Promise.all(
      MAIN.filter(({ label }) => OFF_ROLLUPS.has(label)).map(async (query) => ({
        label: query.label,
        now: await run({ sql: STOCK.get(query.label) ?? "", list }),
        unfiltered: await run({ sql: mainOver({ query, list, rollup: everySource }), list }),
      })),
    );
    const changed = compared.filter(({ now, unfiltered }) => now.rows !== unfiltered.rows);

    // Main counted Langy's and the simulation's traces in these; the list now leaves them out.
    expect(changed.map(({ label }) => label).toSorted()).toEqual(COUNTED_EVERY_SOURCE);
  });

  /** @scenario "The loops queries are compared with main's loops query without its arbitrary cap" */
  it.each(LISTS)("returns main's uncapped loop and retry rows under $list", async ({ list }) => {
    for (const label of UNCAPPED) {
      const main = MAIN.find((query) => query.label === label);
      expect(main?.sql.split(MAIN_CAP)).toHaveLength(3);
      expect(STOCK.get(label)).not.toContain("LIMIT 10000");
      const now = await run({ sql: STOCK.get(label) ?? "", list });
      const before = await run({
        sql: readingFinalTwins({ sql: main ? mainForm(main) : "", database: finalTwins }),
        list,
      });
      expect(now.error, `${label} now`).toBeUndefined();
      expect(now.rows, label).toBe(before.rows);
    }
  });

  /** @scenario "A trace with a second trace_metrics row later in the period counts once" */
  it("returns main's rows when a trace's second trace_metrics row lands later in the period", async () => {
    await moveAnchor({ trace: "a2", day: 3.75 });
    await moveAnchor({ trace: "a1", day: 1.2 });

    expect(await differing(["application"])).toEqual([]);
    expect(await differing(["langy"])).toEqual([]);
  });

  /** @scenario "A sent outcome whose trace moved into the period counts in the period" */
  it("counts a trace moved into the period in the queries dated inside the window", async () => {
    await moveAnchor({ trace: "before1", day: 0.5 });

    // `differing` skips the queries on the trace evaluations; the other suite moves a trace in.
    expect((await differing(["application"])).toSorted()).toEqual(
      IN_WINDOW_DATED.filter((label) => !ON_TRACE_EVALUATIONS.has(label)),
    );
  });

  /** Writes one application trace (unless told another source) using `promptVersion` on `day`. */
  async function writeVersion({
    trace,
    day,
    promptVersion,
    origin = "application",
  }: {
    trace: string;
    day: number;
    promptVersion: string;
    origin?: string;
  }): Promise<void> {
    await writeTrace({ seed: { trace, day, origin, promptVersion, metadata: {} }, updated: day });
  }

  /** The one row att-change/change returns: `version` first used on `day`, after `previous`. */
  function expectChange({
    rows,
    version,
    previous,
    day,
  }: {
    rows: readonly ChangeRow[];
    version: string;
    previous: string;
    day: number;
  }): void {
    expect(rows).toEqual([expect.objectContaining({ version, previous })]);
    expect(rows[0]?.changed_at.startsWith(onDay(day))).toBe(true);
  }

  // These add traces the comparisons above do not expect, so they run last. Each asserts only on
  // versions it wrote, dated after the seed's and each earlier case's, so each also runs alone.
  /** @scenario "A trace whose newest trace_metrics row changed its version reads the newest version" */
  it("reads a trace's version and time from its newest row, as traces does", async () => {
    // Reading U's older row, or its newer version at the older row's time, makes pv-u-prev newest.
    const u: TraceSeed = { trace: "u", day: 5.05, origin: "application", metadata: {} };
    await writeTrace({ seed: { ...u, promptVersion: "pv-u-old" }, updated: 5.05 });
    await writeVersion({ trace: "u-prev", day: 5.1, promptVersion: "pv-u-prev" });
    await writeTrace({ seed: { ...u, day: 5.2, promptVersion: "pv-u-new" }, updated: 5.25 });

    await expectChangeMatchesMain();
    const { floored } = changeForms();
    expectChange({
      rows: await changeRows({ sql: floored, list: ["application"] }),
      version: "pv-u-new",
      previous: "pv-u-prev",
      day: 5.2,
    });
  });

  /** @scenario "A version first used 200 days ago keeps the first-seen time it had" */
  it("dates a version first used 200 days ago from its first use inside the window", async () => {
    await writeVersion({ trace: "ancient", day: -200, promptVersion: "pv-200" });
    await writeVersion({ trace: "p200-prev", day: 5.3, promptVersion: "pv-200-prev" });
    await writeVersion({ trace: "a7", day: 5.4, promptVersion: "pv-200" });

    await expectChangeMatchesMain();
    // Its first use in the window, day 5.4, makes it the newest; all history would make it the
    // oldest.
    const { floored } = changeForms();
    expectChange({
      rows: await changeRows({ sql: floored, list: ["application"] }),
      version: "pv-200",
      previous: "pv-200-prev",
      day: 5.4,
    });
  });

  /** @scenario "A trace whose newest row anchored before the window counts with its in-window version" */
  it("counts a trace whose newest row fell before the window with its in-window version", async () => {
    const t: TraceSeed = { trace: "t", day: 5.6, origin: "application", metadata: {} };
    await writeVersion({ trace: "t-prev", day: 5.5, promptVersion: "pv-t-prev" });
    await writeTrace({ seed: { ...t, promptVersion: "pv-t-in-window" }, updated: 5.6 });
    await writeTrace({
      seed: { ...t, day: -10, promptVersion: "pv-t-before-window" },
      updated: 5.65,
    });

    await expectChangeMatchesMain();
    const { floored } = changeForms();
    expectChange({
      rows: await changeRows({ sql: floored, list: ["application"] }),
      version: "pv-t-in-window",
      previous: "pv-t-prev",
      day: 5.6,
    });
  });

  /**
   * Under application `traces` leaves out a trace with any row from another source
   * (stock-query-sources.ts:186-198), and so does the per-trace HAVING. Under langy both count
   * S with its newest row, the langy one.
   * @scenario "A trace with a row from a source not in the list is left out under the application list"
   */
  it("returns main's rows for a trace whose newest row is from another source", async () => {
    await writeVersion({ trace: "s-app-prev", day: 5.7, promptVersion: "pv-s-app-prev" });
    await writeVersion({ trace: "s-app", day: 5.75, promptVersion: "pv-s-app" });
    await writeVersion({
      trace: "s-langy-prev",
      day: 5.8,
      origin: "langy",
      promptVersion: "pv-s-langy-prev",
    });
    const s: TraceSeed = { trace: "s", day: 6.8, origin: "application", metadata: {} };
    await writeTrace({ seed: { ...s, promptVersion: "pv-s-old" }, updated: 6.8 });
    await writeTrace({
      seed: { ...s, day: 6.9, origin: "langy", promptVersion: "pv-s-new" },
      updated: 6.9,
    });

    await expectChangeMatchesMain();
    const { written, floored } = changeForms();
    for (const sql of [written, floored]) {
      expectChange({
        rows: await changeRows({ sql, list: ["application"] }),
        version: "pv-s-app",
        previous: "pv-s-app-prev",
        day: 5.75,
      });
      expectChange({
        rows: await changeRows({ sql, list: ["langy"] }),
        version: "pv-s-new",
        previous: "pv-s-langy-prev",
        day: 6.9,
      });
    }
  });

  /**
   * S2's newest row is from application and would be the newest version if S2 counted: under
   * application it stays out, because its older row is from langy.
   * @scenario "A trace with a row from a source not in the list is left out under the application list"
   */
  it("leaves out under application a trace that also has a row from another source", async () => {
    await writeVersion({ trace: "s2-app-prev", day: 5.85, promptVersion: "pv-s2-app-prev" });
    await writeVersion({ trace: "s2-app", day: 5.9, promptVersion: "pv-s2-app" });
    const s2: TraceSeed = { trace: "s2", day: 6.85, origin: "langy", metadata: {} };
    await writeTrace({ seed: { ...s2, promptVersion: "pv-s2-langy" }, updated: 6.85 });
    await writeTrace({
      seed: { ...s2, day: 6.95, origin: "application", promptVersion: "pv-s2-application" },
      updated: 6.95,
    });

    await expectChangeMatchesMain();
    const { written, floored, main } = changeForms();
    for (const sql of [main, written, floored]) {
      expectChange({
        rows: await changeRows({ sql, list: ["application"] }),
        version: "pv-s2-app",
        previous: "pv-s2-app-prev",
        day: 5.9,
      });
    }
  });

  /**
   * `traces` looks sources up one window and a day back (stock-query-sources.ts lookupBound): E's
   * langy row on day -7.5 sits in that extra day, before the window before the period (day -7).
   * @scenario "A trace with a row from a source not in the list is left out under the application list"
   */
  it("leaves out under application a trace whose other source's row is in the day before the window", async () => {
    await writeVersion({ trace: "e-app-prev", day: 6, promptVersion: "pv-e-app-prev" });
    await writeVersion({ trace: "e-app", day: 6.05, promptVersion: "pv-e-app" });
    const e: TraceSeed = { trace: "e", day: -7.5, origin: "langy", metadata: {} };
    await writeTrace({ seed: { ...e, promptVersion: "pv-e-langy" }, updated: -7.5 });
    await writeTrace({
      seed: { ...e, day: 6.97, origin: "application", promptVersion: "pv-e-application" },
      updated: 6.97,
    });

    await expectChangeMatchesMain();
    const { written, floored, main } = changeForms();
    for (const sql of [main, written, floored]) {
      expectChange({
        rows: await changeRows({ sql, list: ["application"] }),
        version: "pv-e-app",
        previous: "pv-e-app-prev",
        day: 6.05,
      });
    }
  });
});
