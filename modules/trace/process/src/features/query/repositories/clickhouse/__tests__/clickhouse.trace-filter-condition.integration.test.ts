/**
 * ADR-202 Decided 18 on 26.8: every filter kind read through the built conditions returns the
 * traces main's text returns, with another tenant's rows sharing every trace and run id.
 * @see modules/trace/specs/trace-filter-built-conditions.feature
 */
import { clickhouseRead, tenantScope } from "@langwatch/clickhouse-client/builder";
import { beforeAll, describe, expect, it } from "vitest";

import { expandFragmentForProject } from "../../../../../__tests__/support/authorization-proofs.fixture.ts";
import {
  startMigratedTraceClickHouse,
  testClickHouseConfigured,
} from "../../../../../repositories/clickhouse/__tests__/support/clickhouse-endpoint.support.ts";
import { traceSummaries } from "../../../../../repositories/clickhouse/clickhouse.trace-summaries.table.ts";
import { ClickHouseTraceFacetRegistryRepository } from "../../../../facet/repositories/clickhouse/clickhouse.trace-facet-registry.repository.ts";
import { TraceQueryFieldsService } from "../../../services/trace-query-fields.service.ts";
import { TraceQueryTranslationService } from "../../../services/trace-query-translation.service.ts";
import { compileTraceFilterCondition } from "../clickhouse.trace-filter-condition.mapper.ts";
import { FILTER_KINDS, RUNS, timeRange } from "./trace-filter-kinds.fixture.ts";

type Client = Awaited<ReturnType<typeof startMigratedTraceClickHouse>>;

const fields = TraceQueryFieldsService.create({
  facetRegistry: ClickHouseTraceFacetRegistryRepository.create(),
});
const text = TraceQueryTranslationService.create({ fields });
const run = crypto.randomUUID().slice(0, 8);
const A = `proj_fc_a_${run}`;
const B = `proj_fc_b_${run}`;
const at = (ms: number) => new Date(ms).toISOString().replace("T", " ").replace("Z", "");
const inWindow = at(timeRange.from + 60_000);
const v1 = "v 1";

const summary = (tenant: string, traceId: string, extra: Record<string, unknown> = {}) => ({
  TenantId: tenant,
  TraceId: traceId,
  OccurredAt: inWindow,
  _retention_days: 0,
  CreatedAt: inWindow,
  UpdatedAt: inWindow,
  ComputedInput: "",
  ComputedOutput: "",
  ...extra,
});

/** A's t1 carries every summary value the kinds ask for; B's bait shares the trace ids. */
const SUMMARIES = [
  summary(A, "t1", {
    ContainsErrorStatus: 1,
    TotalCost: 0.3,
    TotalDurationMs: 10,
    Models: ["gpt-5-mini"],
    TraceName: v1,
    TopicId: v1,
    SubTopicId: v1,
    RootSpanType: v1,
    ErrorMessage: v1,
    SelectedPromptId: v1,
    LastUsedPromptId: v1,
    LastUsedPromptVersionNumber: 4,
    TotalPromptTokenCount: 5,
    TotalCompletionTokenCount: 7,
    TimeToFirstTokenMs: 5,
    TimeToLastTokenMs: 6,
    TokensPerSecond: 3,
    SpanCount: 3,
    HasAnnotation: true,
    AnnotationIds: ["an1"],
    Attributes: {
      "langwatch.origin": v1,
      "service.name": v1,
      "langwatch.user_id": v1,
      "gen_ai.conversation.id": v1,
      "langwatch.customer_id": v1,
      "scenario.run_id": "sr1",
      "langwatch.labels": '["urgent"]',
      "langwatch.prompt_ids": '["p1"]',
      k1: "v1",
    },
  }),
  summary(A, "t2", {
    ComputedInput: "say hello",
    Models: ["claude-3"],
    TotalCost: 2,
    Attributes: { "scenario.run_id": "sr2", "gen_ai.conversation.id": "c2" },
  }),
  summary(A, "t3", { TraceName: "abc", Attributes: { "gen_ai.conversation.id": "c3" } }),
  summary(B, "t1", { ComputedOutput: "hello", TotalCost: 9 }),
  summary(B, "t2", { Models: ["gpt-5-mini"], Attributes: { "scenario.run_id": "sr2" } }),
  summary(B, "t3", { Attributes: { "gen_ai.conversation.id": "c3" } }),
];

const span = (tenant: string, traceId: string, spanId: string, extra: Record<string, unknown>) => ({
  TenantId: tenant,
  TraceId: traceId,
  SpanId: spanId,
  StartTime: inWindow,
  EndTime: inWindow,
  CreatedAt: inWindow,
  UpdatedAt: inWindow,
  ...extra,
});

const SPANS = [
  span(A, "t1", "s1", {
    SpanName: "chat",
    StatusCode: 2,
    SpanAttributes: { k1: "v1", "langwatch.span.type": "llm" },
    "Events.Timestamp": [inWindow, inWindow],
    "Events.Name": ["click", "thumbs_up_down"],
    "Events.Attributes": [{ k1: "v1" }, {}],
  }),
  span(B, "t2", "s1", {
    SpanName: "chat",
    StatusCode: 2,
    SpanAttributes: { k1: "v1", "langwatch.span.type": "llm" },
    "Events.Timestamp": [inWindow],
    "Events.Name": ["click"],
    "Events.Attributes": [{ k1: "v1" }],
  }),
  span(B, "t3", "s2", { SpanName: "hello there", StatusCode: 1 }),
];

const evaluation = (
  tenant: string,
  traceId: string,
  id: string,
  extra: Record<string, unknown>,
) => ({
  TenantId: tenant,
  EvaluationId: id,
  EvaluatorId: "ev1",
  EvaluatorName: "faithfulness",
  TraceId: traceId,
  Status: "processed",
  ScheduledAt: inWindow,
  CreatedAt: inWindow,
  UpdatedAt: inWindow,
  ...extra,
});

const EVALUATIONS = [
  evaluation(A, "t1", "e1", { Passed: 0, Label: "bad", UpdatedAt: at(timeRange.from + 1) }),
  evaluation(A, "t1", "e1", { Passed: 1, Score: 0.9, Label: "good" }),
  evaluation(B, "t2", "e9", { Passed: 1, Score: 0.9, Label: "good" }),
  evaluation(B, "t3", "e8", { Passed: 0, Score: 0.1, Label: "bad", Status: "skipped" }),
];

const scenarioRun = (tenant: string, id: string) => ({
  TenantId: tenant,
  ScenarioRunId: id,
  ScenarioId: "sc1",
  ScenarioSetId: "set1",
  BatchRunId: "b1",
  Status: "IN_PROGRESS",
  Verdict: "SUCCESS",
  StartedAt: inWindow,
  CreatedAt: inWindow,
  UpdatedAt: inWindow,
});

const judgment = (tenant: string, runId: string, traceId: string, thread: string) => ({
  TenantId: tenant,
  RunId: runId,
  TraceId: traceId,
  SpanId: "",
  QuestionId: "q1",
  ThreadId: thread,
  Passed: 1,
  CreatedAt: inWindow,
  UpdatedAt: inWindow,
  OccurredAt: inWindow,
  _retention_days: 0,
});

let client: Client;

async function tracesOf(query: string, params: Record<string, unknown>): Promise<string[]> {
  const result = await client.query({ query, query_params: params, format: "JSONEachRow" });
  const rows = (await result.json()) as { TraceId: string }[];
  return [...new Set(rows.map((row) => row.TraceId))].toSorted();
}

async function mainRows(queryText: string): Promise<string[]> {
  const compiled = text.translateFilter({ queryText, timeRange, evalRuns: RUNS });
  if (compiled === null) throw new Error(`'${queryText}' compiled to nothing`);
  const filter = expandFragmentForProject({
    fragment: compiled.sql,
    params: compiled.params,
    projectId: A,
  });
  return tracesOf(
    "SELECT TraceId FROM trace_summaries WHERE TenantId = {mainTenant:String}" +
      " AND OccurredAt >= fromUnixTimestamp64Milli({timeFrom:Int64})" +
      ` AND OccurredAt <= fromUnixTimestamp64Milli({timeTo:Int64}) AND (${filter.sql})`,
    { ...filter.params, mainTenant: A },
  );
}

async function builtRows(queryText: string): Promise<string[]> {
  const scope = tenantScope.single({ tenantId: A });
  const filter = compileTraceFilterCondition({
    queryText,
    timeRange,
    evalRuns: RUNS,
    scope,
    fields,
  });
  if (filter.kind === "empty") throw new Error(`'${queryText}' compiled to nothing`);
  const built = clickhouseRead({ scope })
    .from(traceSummaries)
    .select({ TraceId: traceSummaries.TraceId })
    .where(({ and, gte, lte }) =>
      and(
        gte(traceSummaries.OccurredAt, timeRange.from),
        lte(traceSummaries.OccurredAt, timeRange.to),
      ),
    )
    .where(filter.where)
    .build();
  return tracesOf(built.sql, built.params);
}

describe.skipIf(!testClickHouseConfigured())("trace filter conditions against main's text", () => {
  beforeAll(async () => {
    client = await startMigratedTraceClickHouse();
    const insert = (table: string, values: Record<string, unknown>[]) =>
      client.insert({ table, values, format: "JSONEachRow" });
    await insert("trace_summaries", SUMMARIES);
    await insert("stored_spans", SPANS);
    await insert("evaluation_runs", EVALUATIONS);
    await insert("simulation_runs", [scenarioRun(A, "sr1"), scenarioRun(B, "sr2")]);
    await insert("instant_eval_judgments", [
      judgment(A, "run_t", "t1", "c1"),
      judgment(B, "run_t", "t2", "c2"),
      judgment(A, "run_c", "t1", v1),
      judgment(B, "run_c", "t3", "c3"),
    ]);
  }, 300_000);

  /** @scenario "Each filter kind keeps main's rows with another tenant sharing trace ids" */
  it.each(FILTER_KINDS)("reads %s as main does", async (_kind, queryText) => {
    expect(await builtRows(queryText)).toEqual(await mainRows(queryText));
  });

  /** @scenario "Each filter kind keeps main's rows with another tenant sharing trace ids" */
  it.each([
    ["span attribute", "span.attribute.k1:v1", ["t1"]],
    ["event", "event:click", ["t1"]],
    ["negated free text", "NOT hello", ["t1", "t3"]],
    [
      "evaluator group",
      "evaluator:ev1 AND evaluatorVerdict:pass AND NOT evaluatorLabel:bad",
      ["t1"],
    ],
    ["evaluator name", 'eval:"faithfulness"', ["t1"]],
    ["scenario verdict", "scenarioVerdict:success", ["t1"]],
    ["judged traces", 'eval.trace:"is it kind"', ["t1"]],
    ["unjudged conversations", 'NOT eval:"was it solved"', ["t2", "t3"]],
  ])("keeps another tenant's %s rows from admitting a trace", async (_kind, queryText, traces) => {
    expect(await builtRows(queryText)).toEqual(traces);
  });
});
