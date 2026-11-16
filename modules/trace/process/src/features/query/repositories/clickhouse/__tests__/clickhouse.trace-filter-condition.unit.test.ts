/**
 * ADR-202 Decided 18: the trace filter compiles to builder conditions with the text compiler's
 * parameters, and each side table is read under the filtered read's own scope.
 * @see modules/trace/specs/trace-filter-built-conditions.feature
 */
import {
  clickhouseRead,
  type ReaderScope,
  tenantScope,
} from "@langwatch/clickhouse-client/builder";
import type { TranslationContext } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { aggregateProof } from "../../../../../__tests__/support/authorization-proofs.fixture.ts";
import { traceSummaries } from "../../../../../repositories/clickhouse/clickhouse.trace-summaries.table.ts";
import {
  EVALUATION_RUN_EXPRESSIONS,
  STORED_SPAN_EXPRESSIONS,
  TRACE_SUMMARY_CATEGORICAL_EXPRESSIONS,
  TRACE_SUMMARY_RANGE_EXPRESSIONS,
} from "../../../../facet/repositories/clickhouse/clickhouse.trace-facet-expressions.mapper.ts";
import { ClickHouseTraceFacetRegistryRepository } from "../../../../facet/repositories/clickhouse/clickhouse.trace-facet-registry.repository.ts";
import { TraceQueryFieldsService } from "../../../services/trace-query-fields.service.ts";
import {
  type CompiledTraceFilter,
  compileTraceFilterCondition,
  translateFilterConditions,
} from "../clickhouse.trace-filter-condition.mapper.ts";
import { FILTER_KINDS, RUNS, timeRange } from "./trace-filter-kinds.fixture.ts";
import { FILTER_KIND_PARAMS } from "./trace-filter-kinds.params.fixture.ts";

const facetRegistry = ClickHouseTraceFacetRegistryRepository.create();
const fields = TraceQueryFieldsService.create({ facetRegistry });
const single = tenantScope.single({ tenantId: "proj_a" });

function freshContext(): TranslationContext {
  return {
    paramCounter: 0,
    nodeCount: 0,
    params: { timeFrom: timeRange.from, timeTo: timeRange.to },
    timeRange,
    evalRuns: RUNS,
  };
}

function compiled(queryText: string, scope: ReaderScope = single): CompiledTraceFilter {
  const filter = compileTraceFilterCondition({
    queryText,
    timeRange,
    evalRuns: RUNS,
    scope,
    fields,
  });
  if (filter.kind === "empty") throw new Error(`'${queryText}' compiled to nothing`);
  return filter;
}

function builtSql(queryText: string, scope: ReaderScope = single) {
  const filter = compiled(queryText, scope);
  const read = clickhouseRead({ scope })
    .from(traceSummaries)
    .select({ TraceId: traceSummaries.TraceId })
    .where(filter.where);
  return (scope.kind === "proof" ? read.withinWindows() : read).build();
}

function refusalOf(build: () => unknown): string {
  try {
    build();
  } catch (error: unknown) {
    return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  }
  return "no refusal";
}

describe("given a trace filter of each kind", () => {
  describe("when it is compiled to conditions", () => {
    /** @scenario "Every filter kind compiles to conditions with the text compiler's parameters" */
    it.each(FILTER_KINDS)("binds %s as the text compiler did", (kind, queryText) => {
      const ctx = freshContext();
      const filter = translateFilterConditions({ queryText, ctx, scope: single, fields });

      expect(filter.kind).toBe("compiled");
      expect(ctx.params).toEqual(FILTER_KIND_PARAMS[kind]);
      expect(builtSql(queryText).sql).not.toContain("{{");
    });

    /** @scenario "Every filter kind compiles to conditions with the text compiler's parameters" */
    it.each([
      ["an unknown field", "colour:red", "FilterFieldUnknownError: Unknown field: @colour"],
      [
        "an unknown has value",
        "has:weather",
        'FilterParseError: Unknown has/none value "weather". Valid: error, eval, feedback, annotation, conversation, user, customer, topic, subtopic, label, model, service, traceName, rootSpanType, attribute.<key>',
      ],
      [
        "a bad scenario verdict",
        "scenarioVerdict:maybe",
        'FilterParseError: Unknown scenario verdict "maybe". Valid: success, failure, inconclusive',
      ],
      [
        "an attribute without a key",
        "trace.attribute.:v",
        "FilterParseError: trace.attribute.<key> requires a key after the dot",
      ],
      ["a bad attribute key", "span.attribute.a b:v", "FilterFieldUnknownError: Unknown field: @b"],
      [
        "a value past the length limit",
        `service:${"x".repeat(501)}`,
        "FilterParseError: Filter value too long (max 500 characters)",
      ],
      ["a non-numeric range value", "cost:>abc", "FilterParseError: Not a number: abc"],
      [
        "too many conditions",
        Array.from({ length: 49 }, (_, i) => `user:u${i}`).join(" AND "),
        "FilterTooComplexError: Too many separate terms. Put the sentence in quotes to search it as one phrase.",
      ],
      ["broken syntax", "status:((", "FilterParseError: Invalid filter syntax"],
      [
        "a prototype member",
        "constructor:x",
        "FilterFieldUnknownError: Unknown field: @constructor",
      ],
    ])("refuses %s as the text compiler did", (_case, queryText, refusal) => {
      expect(refusalOf(() => compiled(queryText))).toBe(refusal);
    });

    /** @scenario "Every filter kind compiles to conditions with the text compiler's parameters" */
    it("compiles an empty query to nothing, as the text compiler does", () => {
      expect(
        compileTraceFilterCondition({ queryText: "  ", timeRange, scope: single, fields }),
      ).toEqual({ kind: "empty" });
    });

    /** @scenario "Every filter kind compiles to conditions with the text compiler's parameters" */
    it("builds a builder expression for every registry facet the filter reads by expression", () => {
      const registryKeys = facetRegistry
        .getCatalog()
        .registry.filter((facet) => "expression" in facet)
        .map((facet) => facet.key)
        .filter((key) => key !== "model" && key !== "scenarioRun");

      expect(
        [
          ...Object.keys(TRACE_SUMMARY_CATEGORICAL_EXPRESSIONS),
          ...Object.keys(TRACE_SUMMARY_RANGE_EXPRESSIONS),
          ...Object.keys(EVALUATION_RUN_EXPRESSIONS),
          ...Object.keys(STORED_SPAN_EXPRESSIONS),
        ].toSorted(),
      ).toEqual(registryKeys.toSorted());
    });
  });
});

describe("given a filter on a side table", () => {
  describe("when the filtered read is built", () => {
    /** @scenario "A side-table filter reads its table under the filtered read's own scope" */
    it("reads spans in a set subquery of tenant and trace under the read's scope", () => {
      const built = builtSql("span.attribute.k1:v1");

      expect(built.sql).toContain(
        "tuple(TenantId, TraceId) IN (SELECT DISTINCT TenantId, TraceId FROM stored_spans WHERE TenantId = {tenantId:String}",
      );
      expect(built.sql).toContain("StartTime >= fromUnixTimestamp64Milli(");
      expect(Object.values(built.params)).toEqual(
        expect.arrayContaining([timeRange.from, timeRange.to, "k1", "v1"]),
      );
      expect(compiled("span.attribute.k1:v1").readsSpans).toBe(true);
      expect(compiled("status:error").readsSpans).toBe(false);
    });

    /** @scenario "A side-table filter reads its table under the filtered read's own scope" */
    it("excludes with NOT IN when negated, leaving the subquery's tenant predicate unnegated", () => {
      const { sql } = builtSql("NOT evaluator:ev1");

      expect(sql).toContain(
        "tuple(TenantId, TraceId) NOT IN (SELECT DISTINCT TenantId, TraceId FROM evaluation_runs WHERE TenantId = {tenantId:String}",
      );
      expect(sql).not.toContain("NOT (tuple(");
    });

    /** @scenario "A side-table filter reads its table under the filtered read's own scope" */
    it("negates a free-text span match as NOT IN beside the summary's own NOT", () => {
      expect(builtSql("NOT hello").sql).toContain("tuple(TenantId, TraceId) NOT IN (SELECT");
    });

    /** @scenario "A side-table filter reads its table under the filtered read's own scope" */
    it("elects a scenario run's latest version, the condition outside the election", () => {
      const { sql } = builtSql("scenarioVerdict:success");

      expect(sql).toContain(
        "tuple(TenantId, Attributes[{v0:String}]) IN (SELECT TenantId, ScenarioRunId FROM simulation_runs WHERE TenantId = {tenantId:String}",
      );
      expect(sql).toMatch(/max\(UpdatedAt\)/);
      expect(sql).toContain(
        "(TenantId, ScenarioRunId, UpdatedAt) IN (SELECT TenantId, ScenarioRunId, max(UpdatedAt) FROM simulation_runs",
      );
      expect(sql.indexOf("Verdict =")).toBeLessThan(sql.indexOf("max(UpdatedAt)"));
    });

    /** @scenario "A side-table filter reads its table under the filtered read's own scope" */
    it("keeps a judged conversation by its thread, the verdict and thread in HAVING", () => {
      const { sql } = builtSql('eval.conversation:"was it solved"');

      expect(sql).toContain("FROM instant_eval_judgments WHERE TenantId = {tenantId:String}");
      expect(sql).toContain("GROUP BY TenantId, TraceId, SpanId, QuestionId HAVING");
      expect(sql).toMatch(/argMax\(Passed, UpdatedAt\) = \{v\d+:UInt8\}/);
      expect(sql).toMatch(/argMax\(ThreadId, UpdatedAt\) != \{v\d+:String\}/);
    });
  });
});

describe("given a span filter compiled for a proof-fenced read", () => {
  describe("when the filtered read is built", () => {
    /** @scenario "A span filter under a proof reads the proof's shared windows" */
    it("windows the span subquery by the shared grant, as the read is windowed", () => {
      const proof = tenantScope.fromProof({
        authorization: aggregateProof({
          projectId: "proj_a",
          members: [{ projectId: "proj_b", from: 1_700_000_100_000 }],
        }),
        reads: "traces",
      });
      const windowed = builtSql("event:click", proof);
      const plain = builtSql("event:click");
      const spanRead = (sql: string) => sql.slice(sql.indexOf("FROM stored_spans"));

      expect(spanRead(windowed.sql)).not.toEqual(spanRead(plain.sql));
      expect(spanRead(windowed.sql)).toContain(
        "StartTime >= fromUnixTimestamp64Milli(transform(TenantId, {tenantScope_ids:Array(String)}",
      );
      expect(windowed.params).toMatchObject({ tenantScope_from: [1_700_000_100_000] });
    });

    /** @scenario "Every side-table filter under a share reads only within the share's windows" */
    it.each([
      ["evaluation_runs", "evaluator:ev1", "ScheduledAt"],
      ["evaluation_runs", "evaluatorStatus:processed", "ScheduledAt"],
      ["simulation_runs", "scenarioVerdict:success", "StartedAt"],
      ["instant_eval_judgments", 'eval:"is it kind"', "CreatedAt"],
    ] as const)("windows the %s subquery of %s on %s", (table, query, timeColumn) => {
      const proof = tenantScope.fromProof({
        authorization: aggregateProof({
          projectId: "proj_a",
          members: [{ projectId: "proj_b", from: 1_700_000_100_000 }],
        }),
        reads: "traces",
      });
      const sideRead = (sql: string) => sql.slice(sql.indexOf(`FROM ${table}`));

      expect(sideRead(builtSql(query, proof).sql)).toContain(
        `${timeColumn} >= fromUnixTimestamp64Milli(transform(TenantId, {tenantScope_ids:Array(String)}`,
      );
      expect(sideRead(builtSql(query).sql)).not.toContain("tenantScope_ids");
    });
  });
});
