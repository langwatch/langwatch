/**
 * ADR-202 Decided 18 on 26.8: every filter kind read through the built conditions returns the
 * traces main returned for it (captured once on 26.8, kept as literals), with another tenant's
 * rows sharing every trace and run id.
 * @see modules/trace/specs/trace-filter-built-conditions.feature
 */
import { clickhouseRead, tenantScope } from "@langwatch/clickhouse-client/builder";
import { beforeAll, describe, expect, it } from "vitest";

import {
  startMigratedTraceClickHouse,
  testClickHouseConfigured,
} from "../../../../../repositories/clickhouse/__tests__/support/clickhouse-endpoint.support.ts";
import { traceSummaries } from "../../../../../repositories/clickhouse/clickhouse.trace-summaries.table.ts";
import { ClickHouseTraceFacetRegistryRepository } from "../../../../facet/repositories/clickhouse/clickhouse.trace-facet-registry.repository.ts";
import { TraceQueryFieldsService } from "../../../services/trace-query-fields.service.ts";
import { compileTraceFilterCondition } from "../clickhouse.trace-filter-condition.mapper.ts";
import { FILTER_KINDS, RUNS, timeRange } from "./trace-filter-kinds.fixture.ts";

type Client = Awaited<ReturnType<typeof startMigratedTraceClickHouse>>;

const fields = TraceQueryFieldsService.create({
  facetRegistry: ClickHouseTraceFacetRegistryRepository.create(),
});
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

/** Each kind's traces as main's text returned them for tenant A on 26.8. */
const MAIN_TRACES: Readonly<Record<string, readonly string[]>> = {
  "K0 boolean group": ["t1", "t2"],
  "K0 negated group": ["t2", "t3"],
  "K1 status": [],
  "K1 origin": ["t1"],
  "K1 service": ["t1"],
  "K1 user": ["t1"],
  "K1 conversation": ["t1"],
  "K1 customer": ["t1"],
  "K1 topic": ["t1"],
  "K1 subtopic": ["t1"],
  "K1 traceName": ["t1"],
  "K1 rootSpanType": ["t1"],
  "K1 guardrail": [],
  "K1 annotation": [],
  "K1 containsAi": [],
  "K1 errorMessage": ["t1"],
  "K1 tokensEstimated": [],
  "K1 selectedPrompt": ["t1"],
  "K1 lastUsedPrompt": ["t1"],
  "K2 range": ["t1"],
  "K2 promptVersion": ["t1"],
  "K2 cost": [],
  "K2 duration": ["t1"],
  "K2 tokens": ["t1"],
  "K2 ttft": ["t1"],
  "K2 ttlt": ["t1"],
  "K2 promptTokens": ["t1"],
  "K2 completionTokens": ["t1"],
  "K2 tokensPerSecond": ["t1"],
  "K2 spans": ["t1"],
  "K2 size": ["t1", "t2", "t3"],
  "K2 tokens below": [],
  "K3 trace id": [],
  "K3 trace id wildcard": [],
  "K4 has:error": ["t1"],
  "K4 has:annotation": ["t1"],
  "K4 has:conversation": ["t1", "t2", "t3"],
  "K4 has:user": ["t1"],
  "K4 has:customer": ["t1"],
  "K4 has:topic": ["t1"],
  "K4 has:subtopic": ["t1"],
  "K4 has:label": ["t1"],
  "K4 has:model": ["t1", "t2"],
  "K4 has:service": ["t1"],
  "K4 has:traceName": ["t1", "t3"],
  "K4 has:rootSpanType": ["t1"],
  "K4 has:attribute.k1": ["t1"],
  "K4 has:trace.attribute.k1": ["t1"],
  "K4 none": ["t2", "t3"],
  "K5 prompt": ["t1"],
  "K6 scenario run": ["t1"],
  "K7 model": ["t1"],
  "K7 model wildcard": ["t1"],
  "K8 label": ["t1"],
  "K9 trace attribute": ["t1"],
  "K9 legacy attribute": ["t1"],
  "K10 free text": ["t2"],
  "K10 negated free text": ["t1", "t3"],
  "K11 event": ["t1"],
  "K11 feedback": ["t1"],
  "K11 span id": ["t1"],
  "K11 span id wildcard": ["t1"],
  "K11 event attribute": ["t1"],
  "K11 span attribute": ["t1"],
  "K11 span facets": [],
  "K12 evaluator name": ["t1"],
  "K12 has eval": ["t1"],
  "K12 none eval": ["t2", "t3"],
  "K12 evaluator": ["t1"],
  "K12 evaluation facets": ["t1"],
  "K12 evaluation score and label": ["t1"],
  "K12 old verdict name": ["t1", "t2", "t3"],
  "K13 evaluation scope": [],
  "K13 scope without results": ["t1"],
  "K14 scenario": ["t1"],
  "K14 scenario set and batch": ["t1"],
  "K14 scenario verdict": ["t1"],
  "K14 scenario status": ["t2", "t3"],
  "K15 judged traces": ["t1"],
  "K15 judged conversations": ["t2", "t3"],
  "K15 forced without a run": [],
  "K15 negated forced without a run": ["t1", "t2", "t3"],
};

let client: Client;

async function tracesOf(query: string, params: Record<string, unknown>): Promise<string[]> {
  const result = await client.query({ query, query_params: params, format: "JSONEachRow" });
  const rows = (await result.json()) as { TraceId: string }[];
  return [...new Set(rows.map((row) => row.TraceId))].toSorted();
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

describe.skipIf(!testClickHouseConfigured())("trace filter conditions against main's rows", () => {
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
  it("holds main's rows for every filter kind", () => {
    expect(Object.keys(MAIN_TRACES).toSorted()).toEqual(
      FILTER_KINDS.map(([kind]) => kind).toSorted(),
    );
  });

  /** @scenario "Each filter kind keeps main's rows with another tenant sharing trace ids" */
  it.each(FILTER_KINDS)("reads %s as main does", async (kind, queryText) => {
    expect(await builtRows(queryText)).toEqual(MAIN_TRACES[kind]);
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
