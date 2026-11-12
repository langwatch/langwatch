/**
 * @vitest-environment node
 * The twenty-one stock queries moved onto the trace evaluations return main's rows, over unmerged
 * retraction pairs and a trace whose copied columns changed (analytics ADR-007).
 * @see specs/lwql/stock-widgets-read-trace-evaluations.feature
 */
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

/** Main's SQL for every stock query, which joined evaluation_metrics to trace_metrics. */
const MAIN = new Map(fixture("stock-widget-queries.main.json").map((q) => [q.label, q.sql]));
const STOCK = new Map(fixture("stock-widget-queries.json").map((q) => [q.label, q.sql]));
/** The moved queries as this branch read them before the move. */
const BEFORE = fixture("stock-widget-queries.trace-evaluations-baseline.json");
const MOVED = BEFORE.map(({ label }) => label);

const TENANT = TENANT_A.tenantId;
const TOPIC_ONE = `${TENANT}-topic-1`;
const TOPIC_TWO = `${TENANT}-topic-2`;
const OUTCOME_JUDGE = "Conversation Outcome Judge";

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
  /** Written after the first version, with a later UpdatedAt. */
  version?: number;
};

/** Every column the moved queries read, over sources, both periods and a 40-day-old trace. */
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
    metadata: { outcome: "capability_gap", outcome_reason: "no refunds", topic: "refunds" },
  },
  {
    trace: "a3",
    day: 3.5,
    origin: "application",
    customer: "globex",
    labels: ["beta"],
    topic: TOPIC_TWO,
    promptVersion: "pv-2",
    metadata: {},
  },
  { trace: "a4", day: 4, origin: "", customer: "globex", metadata: { document_type: "invoice" } },
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
    metadata: { topic: "billing" },
  },
  { trace: "before2", day: -3, origin: "application", metadata: { prompt_version: "m1" } },
  { trace: "old", day: -40, origin: "application", metadata: {} },
  // Dated before the period, with outcome and check re-runs inside it: the move-in case.
  {
    trace: "mv1",
    day: -2,
    origin: "application",
    topic: TOPIC_TWO,
    metadata: { topic: "refunds" },
  },
  // mv1's shape with no outcome metadata, moved on the real views in its own test.
  { trace: "mv2", day: -2.5, origin: "application", metadata: {} },
  { trace: "l1", day: 1.5, origin: "langy", promptVersion: "pv-9", metadata: { language: "de" } },
  { trace: "l2", day: 3, origin: "langy", topic: TOPIC_TWO, metadata: { outcome: "refusal" } },
];

/** The trace whose copied columns change after its evaluations were written. */
const CHANGED_TRACE_BEFORE: TraceSeed = {
  trace: "c1",
  day: 2.2,
  origin: "application",
  customer: "hooli",
  metadata: { topic: "shipping", prompt_version: "m1" },
};
const CHANGED_TRACE_AFTER: TraceSeed = {
  ...CHANGED_TRACE_BEFORE,
  customer: "umbrella",
  metadata: { topic: "returns", prompt_version: "m2" },
  version: 2,
};

/** Every trace as it reads now. */
const LATEST_TRACES = [...TRACES, CHANGED_TRACE_AFTER];
const traceOf = (trace: string): TraceSeed => {
  const found = LATEST_TRACES.find((seed) => seed.trace === trace);
  if (!found) throw new Error(`no seed ${trace}`);
  return found;
};

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
 * goose 00128 ones are the fold's to write, so the row carries them as the fold does.
 */
function analyticsRow(seed: TraceSeed): Record<string, unknown> {
  const version = seed.version ?? 1;
  return {
    MetadataOutcomeReason: seed.metadata.outcome_reason ?? "",
    MetadataPromptVersion: seed.metadata.prompt_version ?? "",
    MetadataEnvironment: "",
    TenantId: TENANT,
    TraceId: seed.trace,
    Version: String(version),
    OccurredAt: onDay(seed.day),
    CreatedAt: onDay(seed.day),
    UpdatedAt: onDay(seed.day + 0.5 * (version - 1)),
    TraceName: seed.trace,
    TopicId: seed.topic ?? null,
    CustomerId: seed.customer ?? null,
    Origin: seed.origin,
    Models: ["gpt-5"],
    Labels: seed.labels ?? [],
    TotalCost: 0.5,
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

type EvaluationSeed = {
  id: string;
  trace: string;
  name: string;
  label?: string | null;
  passed?: boolean | null;
  /** Days after its trace began that the evaluation reached this state. */
  after?: number;
};

const judge = (trace: string, label: string): EvaluationSeed => ({
  id: `judge-${trace}`,
  trace,
  name: OUTCOME_JUDGE,
  label,
});
const check = (trace: string, name: string, passed: boolean, n = 0): EvaluationSeed => ({
  id: `${name}-${trace}-${n}`,
  trace,
  name,
  passed,
});

/**
 * Reviewer checks on the thumbed traces: two per application trace, ten per langy trace.
 * Langy needs ten because ck-attention/agreement only shows an evaluator with at least ten
 * audited checks.
 */
const REVIEWED = ["a1", "a2", "a3", "a4", "c1", "l1"];
const reviewerChecksOn = (trace: string) => (traceOf(trace).origin === "langy" ? 10 : 2);
const REVIEWER_CHECKS = REVIEWED.flatMap((trace, index) =>
  Array.from({ length: reviewerChecksOn(trace) }, (_, n) =>
    check(trace, "Reviewer Check", (index + n) % 2 === 0, n),
  ),
);

/** Each evaluation's first state. */
const EVALUATIONS: EvaluationSeed[] = [
  judge("a5", "resolved"),
  judge("a6", "capability_gap"),
  judge("a1", "refusal"),
  judge("before2", "refusal"),
  judge("l1", "misunderstood"),
  judge("c1", "capability_gap"),
  // Re-run long after its 40-day-old trace: inside the period, its trace is not.
  { ...judge("old", "resolved"), after: 39 },
  { ...judge("mv1", "capability_gap"), after: 3 },
  { ...check("mv1", "Quality", true), after: 3 },
  { ...judge("mv2", "capability_gap"), after: 3 },
  { ...check("mv2", "Quality", true), after: 3 },
  check("a1", "Quality", true),
  check("a1", "Tone", false),
  check("a2", "Quality", true),
  check("a3", "Quality", false),
  check("a4", "Quality", true),
  check("before1", "Quality", true),
  check("l1", "Quality", true),
  check("a6", "Guard", true),
  check("c1", "Quality", true),
  ...REVIEWER_CHECKS,
];

/** Evaluations whose outcome changed: a retraction pair in `trace_evaluation_analytics`. */
const CHANGED_EVALUATIONS: EvaluationSeed[] = [
  { ...check("a3", "Quality", true), after: 0.3 },
  { ...judge("a6", "resolved"), after: 0.4 },
];

/** Each evaluation as it reads now. */
const LATEST_EVALUATIONS = EVALUATIONS.map(
  (seed) => CHANGED_EVALUATIONS.find((changed) => changed.id === seed.id) ?? seed,
);

const isGuardrail = (seed: EvaluationSeed) => seed.name === "Guard";
const evaluatedAt = (seed: EvaluationSeed) => onDay(traceOf(seed.trace).day + (seed.after ?? 0.2));

function evaluationAnalyticsRow(seed: EvaluationSeed): Record<string, unknown> {
  return {
    TenantId: TENANT,
    EvaluationId: seed.id,
    Version: "1",
    OccurredAt: evaluatedAt(seed),
    CreatedAt: onDay(traceOf(seed.trace).day),
    UpdatedAt: evaluatedAt(seed),
    EvaluatorType: "llm",
    EvaluatorName: seed.name,
    Status: "processed",
    IsGuardrail: isGuardrail(seed),
    Passed: seed.passed ?? null,
    Label: seed.label ?? null,
    TraceId: seed.trace,
    Origin: traceOf(seed.trace).origin,
  };
}

/** The outcome judge's run, which main's outcome widgets read through `evaluations`. */
function evaluationRunRow({
  seed,
  version,
}: {
  seed: EvaluationSeed;
  version: number;
}): Record<string, unknown> {
  const scheduled = onDay(traceOf(seed.trace).day + 0.1);
  return {
    ProjectionId: seed.id,
    TenantId: TENANT,
    EvaluationId: seed.id,
    Version: String(version),
    EvaluatorId: seed.name,
    EvaluatorType: "llm",
    EvaluatorName: seed.name,
    TraceId: seed.trace,
    IsGuardrail: 0,
    Status: "processed",
    Label: seed.label ?? null,
    Details: `reason for ${seed.id}`,
    CreatedAt: scheduled,
    UpdatedAt: evaluatedAt(seed),
    ScheduledAt: scheduled,
    LastEventOccurredAt: evaluatedAt(seed),
  };
}

const isJudge = (seed: EvaluationSeed) => seed.name === OUTCOME_JUDGE;

/** The `trace_evaluation_analytics` row the trace fold writes for `evaluation` on `trace`. */
function traceEvaluationRow({
  evaluation,
  trace,
  sign,
  revision,
}: {
  evaluation: EvaluationSeed;
  trace: TraceSeed;
  sign: 1 | -1;
  revision: number;
}): Record<string, unknown> {
  const metadata = (key: string) => trace.metadata[key] ?? "";
  return {
    TenantId: TENANT,
    TraceId: trace.trace,
    EvaluationId: evaluation.id,
    OccurredAt: evaluatedAt(evaluation),
    UpdatedAt: onDay(trace.day + revision),
    TraceOccurredAt: onDay(trace.day),
    EvaluatorName: evaluation.name,
    Status: "processed",
    IsGuardrail: isGuardrail(evaluation),
    Passed: evaluation.passed ?? null,
    Label: evaluation.label ?? null,
    Origin: trace.origin,
    TraceOrigin: trace.origin,
    CustomerId: trace.customer ?? null,
    TopicId: trace.topic ?? null,
    Labels: trace.labels ?? [],
    MetadataTopic: metadata("topic"),
    MetadataDocumentType: metadata("document_type"),
    MetadataLanguage: metadata("language"),
    MetadataTeam: metadata("team"),
    MetadataFlow: metadata("flow"),
    MetadataSegment: metadata("segment"),
    MetadataPromptVersion: metadata("prompt_version"),
    Sign: sign,
    Revision: revision,
  };
}

const firstTraceOf = (trace: string) =>
  trace === CHANGED_TRACE_BEFORE.trace ? CHANGED_TRACE_BEFORE : traceOf(trace);
const isRewritten = (seed: EvaluationSeed) =>
  seed.trace === CHANGED_TRACE_BEFORE.trace ||
  CHANGED_EVALUATIONS.some((changed) => changed.id === seed.id);

/** The fold's writes in order: first rows, then each retraction, then each new revision. */
function traceEvaluationWrites(): Record<string, unknown>[][] {
  const first = (seed: EvaluationSeed, sign: 1 | -1) =>
    traceEvaluationRow({ evaluation: seed, trace: firstTraceOf(seed.trace), sign, revision: 1 });
  const rewritten = EVALUATIONS.filter(isRewritten);
  return [
    EVALUATIONS.map((seed) => first(seed, 1)),
    rewritten.map((seed) => first(seed, -1)),
    LATEST_EVALUATIONS.filter(isRewritten).map((seed) =>
      traceEvaluationRow({ evaluation: seed, trace: traceOf(seed.trace), sign: 1, revision: 2 }),
    ),
  ];
}

/**
 * What the trace fold writes when a trace's anchor moves: a later `trace_analytics` row, and
 * for each evaluation the live row retracted byte for byte plus a new revision. Each entry is
 * its own INSERT; with merges stopped the views settle the pairs on read.
 */
function moveWrites({
  trace,
  day,
}: {
  trace: string;
  day: number;
}): [string, Record<string, unknown>[]][] {
  const live = traceOf(trace);
  const moved: TraceSeed = { ...live, day, version: (live.version ?? 1) + 1 };
  const evaluations = LATEST_EVALUATIONS.filter((seed) => seed.trace === trace);
  if (evaluations.length === 0) throw new Error(`${trace} has no evaluations to move`);
  const rowsFor = ({ sign, next }: { sign: 1 | -1; next: boolean }) =>
    evaluations.map((evaluation) => {
      const revision = isRewritten(evaluation) ? 2 : 1;
      return traceEvaluationRow({
        evaluation,
        trace: next ? moved : live,
        sign,
        revision: next ? revision + 1 : revision,
      });
    });
  return [
    ["trace_analytics", [analyticsRow(moved)]],
    ["trace_evaluation_analytics", rowsFor({ sign: -1, next: false })],
    ["trace_evaluation_analytics", rowsFor({ sign: 1, next: true })],
  ];
}

/**
 * Creates `<database>_latest` holding trace_metrics read once per trace, at its latest row. A
 * moved pre-freeze trace keeps two trace_metrics rows (ADR-071), so the moved-trace cases read
 * it here in both forms and compare the evaluation side alone. Returns the database's name.
 */
async function provisionOneRowPerTrace({
  harness,
}: {
  harness: LangWatchQLClickHouseHarness;
}): Promise<string> {
  const database = `${harness.names.database}_latest`;
  const traceMetrics = LWQL_VIEW_CATALOG.find((view) => view.name === "trace_metrics");
  if (!traceMetrics) throw new Error("no trace_metrics in the catalogue");
  const onePerTrace = {
    ...traceMetrics,
    dedup: { ...traceMetrics.dedup, keyColumns: ["TenantId", "TraceId"] },
  };
  await harness.applyAsAdmin([
    `DROP DATABASE IF EXISTS ${database}`,
    `CREATE DATABASE ${database}`,
    ...viewProvisioning.setupStatements({
      names: { ...harness.names, database },
      sourceDatabase: harness.factDatabase,
      views: [onePerTrace],
      dedup: SHIPPED_LWQL_DEDUP,
    }),
    `GRANT SELECT ON ${database}.* TO ${harness.names.restrictedUser}`,
  ]);
  return database;
}

/** The SQL with every FROM or JOIN of trace_metrics pointed at the one-row-per-trace view. */
function readingOneRowPerTrace({ sql, database }: { sql: string; database: string }): string {
  return sql.replace(
    /\b(FROM|JOIN)(\s+)(?:analytics\.)?trace_metrics\b(?!\.)/gi,
    (_match, keyword: string, space: string) => `${keyword}${space}${database}.trace_metrics`,
  );
}

type SpanSeed = { trace: string; span: string; parent: string | null; contexts?: number };

/** Searches that found nothing, found something, and one in a Langy trace. */
const SPANS: SpanSeed[] = [
  { trace: "a1", span: "r", parent: null },
  { trace: "a1", span: "g", parent: "r", contexts: 2 },
  { trace: "a2", span: "r", parent: null },
  { trace: "a2", span: "g", parent: "r", contexts: 0 },
  { trace: "a3", span: "g", parent: null, contexts: 1 },
  { trace: "c1", span: "g", parent: null, contexts: 3 },
  { trace: "l1", span: "g", parent: null, contexts: 0 },
];

const spanStart = (seed: SpanSeed) => PERIOD_START + (traceOf(seed.trace).day + 0.001) * DAY;

/** The `stored_spans` row main's form reads through `spans` and its attribute map. */
function spanRow(seed: SpanSeed): Record<string, unknown> {
  const start = spanStart(seed);
  const rag =
    seed.contexts === undefined
      ? {}
      : {
          "langwatch.span.type": "rag",
          "langwatch.rag.contexts": JSON.stringify(
            Array.from({ length: seed.contexts }, (_, n) => ({ c: n })),
          ),
        };
  return {
    ProjectionId: `${TENANT}/${seed.trace}/${seed.span}`,
    TenantId: TENANT,
    TraceId: seed.trace,
    SpanId: seed.span,
    ParentSpanId: seed.parent,
    StartTime: at(start),
    EndTime: at(start + 1000),
    DurationMs: 100,
    SpanName: seed.contexts === undefined ? "agent" : "retrieve",
    SpanAttributes: rag,
    ResourceAttributes: {},
    StatusCode: null,
    Cost: null,
    CreatedAt: at(start),
    UpdatedAt: at(start),
  };
}

/** The `span_analytics` row the trace module's span projection writes for `seed`. */
function spanAnalyticsRow(seed: SpanSeed): Record<string, unknown> {
  const start = spanStart(seed);
  return {
    TenantId: TENANT,
    TraceId: seed.trace,
    SpanId: seed.span,
    ParentSpanId: seed.parent,
    StartTime: at(start),
    EndTime: at(start + 1000),
    DurationMs: 100,
    SpanName: seed.contexts === undefined ? "agent" : "retrieve",
    SpanKind: 0,
    StatusCode: null,
    Cost: null,
    NonBilledCost: null,
    SpanType: seed.contexts === undefined ? "" : "rag",
    ErrorType: "",
    RagContextCount: seed.contexts ?? 0,
    InputHash: "0",
    DeploymentEnvironment: "",
    ProjectedAt: at(start),
  };
}

/** Reviewer thumbs, inside the period, on the traces the reviewer checks ran on. */
function annotationInserts(): string {
  const values = REVIEWED.map((trace, index) => {
    const created = `'${onDay(traceOf(trace).day + 0.3)}'`;
    return (
      `('${TENANT}-review-${trace}', '${TENANT}', '${trace}', ${index % 3 !== 1}, ` +
      `'review', 'reviewer@example.com', ${created}, ${created})`
    );
  });
  return (
    `INSERT INTO public."Annotation" ` +
    `("id", "projectId", "traceId", "isThumbsUp", "comment", "email", "createdAt", "updatedAt") ` +
    `VALUES ${values.join(", ")}`
  );
}

describe("given trace evaluations with unmerged retraction pairs beside main's facts", () => {
  let harness: LangWatchQLClickHouseHarness;
  let postgres: LangWatchQLPostgresHarness;
  let client: ClickHouseClient;
  let finalTwins: string;
  let oneRowPerTrace: string;

  /** The query's rows in a stable order, or its error, so one failure does not hide the rest. */
  async function run({
    sql,
    list,
  }: {
    sql: string;
    list: readonly string[];
  }): Promise<{ rows?: string; count?: number; error?: string }> {
    try {
      const result = await client.query({
        query: sql,
        query_params: { ...PARAMETERS, dashboard_context_sources: list },
        format: "JSONEachRow",
      });
      const rows = (await result.json<Record<string, unknown>>()).map((row) => JSON.stringify(row));
      return { rows: JSON.stringify(rows.toSorted()), count: rows.length };
    } catch (error) {
      return { error: error instanceof Error ? error.message.slice(0, 600) : String(error) };
    }
  }

  /** The moved query as the executor sends it: each trace evaluation read on its floored twin. */
  function sent(label: string): string {
    const sql = STOCK.get(label) ?? "";
    const floored = floorLangWatchQLDedup({
      sql,
      database: harness.names.database,
      views: LWQL_VIEW_CATALOG,
    });
    expect(floored, label).not.toBe(sql);
    return floored;
  }

  async function moveTrace({ trace, day }: { trace: string; day: number }): Promise<void> {
    for (const [table, values] of moveWrites({ trace, day })) {
      await harness.admin.insert({
        table: `${harness.factDatabase}.${table}`,
        format: "JSONEachRow",
        values,
      });
    }
  }

  /** Every moved query reads the moved trace as its pre-move form reads it once, at its latest. */
  async function expectMovedQueriesMatchBaseline(): Promise<void> {
    const onePerTrace = (sql: string) => readingOneRowPerTrace({ sql, database: oneRowPerTrace });
    const differing: string[] = [];
    for (const { list } of LISTS) {
      for (const { label, sql: before } of BEFORE) {
        const now = await run({ sql: onePerTrace(sent(label)), list });
        const moved = await run({ sql: onePerTrace(before), list });
        expect(now.error, `${label} now under ${list.join(", ")}`).toBeUndefined();
        expect(moved.error, `${label} before the move under ${list.join(", ")}`).toBeUndefined();
        if (now.rows !== moved.rows) differing.push(`${label} under ${list.join(", ")}`);
      }
    }
    expect(differing).toEqual([]);
  }

  /** The move wrote a second, unmerged `trace_analytics` row, so the views must pick the later. */
  async function expectTwoAnalyticsRows(trace: string): Promise<void> {
    const result = await harness.admin.query({
      query: `SELECT count() AS n FROM ${harness.factDatabase}.trace_analytics WHERE TenantId = {tenant:String} AND TraceId = {trace:String}`,
      query_params: { tenant: TENANT, trace },
      format: "JSONEachRow",
    });
    const [{ n } = { n: "0" }] = await result.json<{ n: string }>();
    expect(Number(n), `${trace} trace_analytics rows`).toBe(2);
  }

  beforeAll(async () => {
    postgres = await startLangWatchQLPostgres();
    const annotated = await postgres.asAdmin(annotationInserts());
    if (annotated.exitCode !== 0) throw new Error(`annotations not seeded: ${annotated.stderr}`);
    harness = await startLangWatchQLClickHouse({
      suite: "trace-evaluations-rows",
      facts: "migrated",
    });
    const { names, factDatabase: facts } = harness;
    await mapPostgresIntoClickHouse({ harness, postgres });
    await harness.applyAsAdmin(
      viewProvisioning.setupStatements({ names, sourceDatabase: facts, dedup: SHIPPED_LWQL_DEDUP }),
    );
    await harness.applyAccessModel({ views: LWQL_VIEW_CATALOG, sourceDatabase: facts });
    finalTwins = await provisionFinalTwins({ harness });
    oneRowPerTrace = await provisionOneRowPerTrace({ harness });
    // The pairs stay unmerged, so the views must settle them on read (analytics ADR-007).
    await harness.applyAsAdmin([
      `SYSTEM STOP MERGES ${facts}.trace_evaluation_analytics`,
      `SYSTEM STOP MERGES ${facts}.trace_analytics`,
    ]);

    const inserts: [string, Record<string, unknown>[]][] = [
      ["trace_summaries", LATEST_TRACES.map(summaryRow)],
      ["trace_analytics", [...TRACES, CHANGED_TRACE_BEFORE].map(analyticsRow)],
      ["trace_analytics", [CHANGED_TRACE_AFTER].map(analyticsRow)],
      ["stored_spans", SPANS.map(spanRow)],
      ["span_analytics", SPANS.map(spanAnalyticsRow)],
      [
        "evaluation_runs",
        EVALUATIONS.filter(isJudge).map((seed) => evaluationRunRow({ seed, version: 1 })),
      ],
      [
        "evaluation_runs",
        CHANGED_EVALUATIONS.filter(isJudge).map((seed) => evaluationRunRow({ seed, version: 2 })),
      ],
      ["evaluation_analytics", EVALUATIONS.map(evaluationAnalyticsRow)],
      ["evaluation_analytics", CHANGED_EVALUATIONS.map(evaluationAnalyticsRow)],
      ...traceEvaluationWrites().map(
        (values) => ["trace_evaluation_analytics", values] as [string, Record<string, unknown>[]],
      ),
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

  const EACH_MOVED_QUERY = LISTS.flatMap(({ list }) => MOVED.map((label) => ({ label, list })));
  /** @scenario "Each moved stock query returns the rows main's form returned" */
  it.each(EACH_MOVED_QUERY)(
    "returns main's rows and the pre-move rows for $label under $list",
    async ({ label, list }) => {
      const before = BEFORE.find((query) => query.label === label)?.sql ?? "";
      const now = await run({ sql: sent(label), list });
      const main = await run({
        sql: readingFinalTwins({ sql: MAIN.get(label) ?? "", database: finalTwins }),
        list,
      });
      const moved = await run({ sql: before, list });
      expect(now.error, "now").toBeUndefined();
      expect(main.error, "main").toBeUndefined();
      expect(moved.error, "before the move").toBeUndefined();
      expect(now.rows, "against main").toBe(main.rows);
      expect(now.rows, "against the pre-move form").toBe(moved.rows);
    },
  );

  /** @scenario "Each moved stock query returns the rows main's form returned" */
  it.each(EACH_MOVED_QUERY)("seeds rows for $label under $list", async ({ label, list }) => {
    const { count, error } = await run({ sql: sent(label), list });
    expect(error).toBeUndefined();
    expect(count, `${label} under ${list.join(", ")}`).toBeGreaterThan(0);
  });

  /** @scenario "An unmerged retraction pair counts the evaluation once, at its latest outcome" */
  it("reads each evaluation once, at its latest outcome, over the unmerged pairs", async () => {
    const retractions = await harness.admin.query({
      query: `SELECT count() AS n FROM ${harness.factDatabase}.trace_evaluation_analytics WHERE Sign = -1`,
      format: "JSONEachRow",
    });
    const [{ n } = { n: "0" }] = await retractions.json<{ n: string }>();
    expect(Number(n)).toBeGreaterThan(0);

    const result = await client.query({
      query:
        "SELECT EvaluationId, Passed, Label, CustomerId FROM trace_evaluation_metrics ORDER BY EvaluationId",
      format: "JSONEachRow",
    });
    const rows = await result.json<Record<string, unknown>>();
    expect(rows).toEqual(
      LATEST_EVALUATIONS.map((seed) => ({
        EvaluationId: seed.id,
        Passed: seed.passed ?? null,
        Label: seed.label ?? null,
        CustomerId: traceOf(seed.trace).customer ?? null,
      })).toSorted((a, b) => (a.EvaluationId < b.EvaluationId ? -1 : 1)),
    );
  });

  /** @scenario "A trace whose copied columns changed is read with their new values" */
  it("groups the changed trace's checks under its new customer only", async () => {
    const { rows, error } = await run({
      sql: sent("ck-attention/segments"),
      list: ["application"],
    });
    expect(error).toBeUndefined();
    const segments = (JSON.parse(rows ?? "[]") as string[]).map(
      (row) => JSON.parse(row) as { segment: string; kind: string; n: string },
    );
    expect(segments.map(({ segment }) => segment)).not.toContain("hooli");
    const umbrella = segments.find(({ segment }) => segment === "umbrella");
    expect(umbrella).toMatchObject({ kind: "customer" });
    expect(Number(umbrella?.n)).toBe(3);
  });

  // These tests move traces for good, so they run after every test that reads the seeded data.
  /** @scenario "A trace whose second trace_metrics row lands later in the period counts once" */
  it("reads every moved query once for a trace moved later in the period", async () => {
    await moveTrace({ trace: "a1", day: 6.3 });
    await expectTwoAnalyticsRows("a1");
    await expectMovedQueriesMatchBaseline();
  });

  /** @scenario "A trace moved into the period from before it counts in the period" */
  it("reads every moved query for a trace moved into the period", async () => {
    await moveTrace({ trace: "mv1", day: 4.5 });
    await expectTwoAnalyticsRows("mv1");
    await expectMovedQueriesMatchBaseline();
  });

  /** The query's one row under the application list; each expected key as a number. */
  async function countsOf<K extends string>(
    label: string,
    keys: readonly K[],
  ): Promise<Record<K, number>> {
    const { rows, error } = await run({ sql: sent(label), list: ["application"] });
    expect(error, label).toBeUndefined();
    const [row = "{}"] = JSON.parse(rows ?? "[]") as string[];
    const counts = JSON.parse(row) as Record<string, string | number>;
    const result = {} as Record<K, number>;
    for (const key of keys) {
      const value = counts[key];
      if (value === undefined) throw new Error(`${label} has no ${key}`);
      result[key] = Number(value);
    }
    return result;
  }

  // On the real views: main read the moved trace's two trace_metrics rows, so this differs from
  // main by design. mv2 has one passed Quality check and one capability_gap judge, both in the
  // period; moving its anchor from the previous period into this one moves each count by one.
  /** @scenario "A moved pre-freeze trace counts once, at its latest time, on the real views" */
  it("counts a moved pre-freeze trace once, at its latest time, on the real views", async () => {
    const checkKeys = ["passed", "judged", "passed_prev", "judged_prev"] as const;
    const outcomeKeys = ["closed", "resolved", "closed_prev", "resolved_prev"] as const;
    const checks = await countsOf("ck-kpis/checks", checkKeys);
    const outcomes = await countsOf("ck-kpis/outcomes", outcomeKeys);
    await moveTrace({ trace: "mv2", day: 4.5 });
    await expectTwoAnalyticsRows("mv2");
    expect(await countsOf("ck-kpis/checks", checkKeys)).toEqual({
      passed: checks.passed + 1,
      judged: checks.judged + 1,
      passed_prev: checks.passed_prev - 1,
      judged_prev: checks.judged_prev - 1,
    });
    expect(await countsOf("ck-kpis/outcomes", outcomeKeys)).toEqual({
      closed: outcomes.closed + 1,
      resolved: outcomes.resolved,
      closed_prev: outcomes.closed_prev - 1,
      resolved_prev: outcomes.resolved_prev,
    });
  });
});
