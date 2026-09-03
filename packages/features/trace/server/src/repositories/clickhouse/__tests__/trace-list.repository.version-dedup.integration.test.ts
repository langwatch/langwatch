/**
 * @vitest-environment node
 * @integration
 *
 * `trace_summaries` keeps every version of a trace's row until the merge
 * collapses them, so a filter evaluated before the version dedup reads a stale
 * version as if it were current.
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FACET_REGISTRY } from "../../../adapters/trace-facet-registry.clickhouse.adapter";
import { TraceQueryClickHouse } from "../../../adapters/trace-query.clickhouse.adapter";
import { TraceListClickHouseRepository } from "../trace-list.repository";
import { createTestClickHouseClient, testClickHouseUrl } from "./support/clickhouse-endpoint.support";

const clickHouseUrl = testClickHouseUrl();
const integration = describe.skipIf(clickHouseUrl === null);

let ch: ClickHouseClient;
let repo: TraceListClickHouseRepository;

const base = Date.now() - 60 * 60 * 1000;

function makeTraceSummaryRow(i: number, overrides: Record<string, unknown> = {}) {
  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: "unused",
    TraceId: `tr-${String(i).padStart(4, "0")}`,
    Version: "v1",
    Attributes: {},
    OccurredAt: new Date(base + i),
    CreatedAt: new Date(base + i),
    UpdatedAt: new Date(base + i),
    ComputedIOSchemaVersion: "v1",
    ComputedInput: `input-${i}`,
    ComputedOutput: `output-${i}`,
    TimeToFirstTokenMs: null,
    TimeToLastTokenMs: null,
    TotalDurationMs: 100,
    TokensPerSecond: null,
    SpanCount: 1,
    ContainsErrorStatus: false,
    ContainsOKStatus: true,
    ErrorMessage: null,
    Models: [],
    TotalCost: null,
    TokensEstimated: false,
    TotalPromptTokenCount: null,
    TotalCompletionTokenCount: null,
    OutputFromRootSpan: false,
    OutputSpanEndTimeMs: 0,
    BlockedByGuardrail: false,
    TraceName: `trace-${i}`,
    RootSpanType: "",
    ContainsAi: false,
    ContainsPrompt: false,
    AnnotationIds: [],
    LastEventOccurredAt: new Date(base + i),
    TopicId: null,
    SubTopicId: null,
    ...overrides,
  };
}

async function insertRows(rows: ReturnType<typeof makeTraceSummaryRow>[]) {
  await ch.insert({
    table: "trace_summaries",
    values: rows,
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
}

integration("TraceListClickHouseRepository filtering across row versions", () => {
  const versionTenant = `test-version-leak-${nanoid()}`;
  const versionedTraceId = "vl-annotated";
  const timeRange = { from: base - 60_000, to: base + 60_000 };

  const annotationFacetExpression = (() => {
    const def = FACET_REGISTRY.find((facet) => facet.key === "annotation");
    if (!def || !("expression" in def)) {
      throw new Error("the annotation facet no longer carries an expression");
    }
    return def.expression;
  })();

  /** The filter the sidebar compiles, so the test reads the production SQL. */
  const filterFor = (queryText: string) => {
    const compiled = TraceQueryClickHouse.translateFilter(queryText, versionTenant, timeRange);
    if (!compiled) throw new Error(`"${queryText}" compiled to no filter`);
    return compiled;
  };

  const listWith = (queryText: string) =>
    repo.findAll({
      tenantId: versionTenant,
      timeRange,
      sort: { column: "OccurredAt", direction: "desc" },
      limit: 50,
      offset: 0,
      filterWhere: filterFor(queryText),
    });

  beforeAll(async () => {
    if (!clickHouseUrl) return;
    ch = createTestClickHouseClient(clickHouseUrl);
    repo = TraceListClickHouseRepository.create(async () => ch);

    // Two versions of one trace, written as two parts so no merge collapses
    // them: the older one was never annotated, the newer one carries the
    // comment a reviewer just left.
    await insertRows([
      makeTraceSummaryRow(0, {
        TenantId: versionTenant,
        TraceId: versionedTraceId,
        OccurredAt: new Date(base),
        CreatedAt: new Date(base),
        UpdatedAt: new Date(base),
        LastEventOccurredAt: new Date(base),
        HasAnnotation: null,
        AnnotationIds: [],
      }),
    ]);
    await insertRows([
      makeTraceSummaryRow(0, {
        TenantId: versionTenant,
        TraceId: versionedTraceId,
        OccurredAt: new Date(base),
        CreatedAt: new Date(base),
        UpdatedAt: new Date(base + 5_000),
        LastEventOccurredAt: new Date(base),
        HasAnnotation: true,
        AnnotationIds: ["annotation-1"],
      }),
    ]);
  }, 120_000);

  afterAll(async () => {
    if (!ch) return;
    await ch.exec({
      query: "ALTER TABLE trace_summaries DELETE WHERE TenantId = {tenantId:String}",
      query_params: { tenantId: versionTenant },
    });
  });

  describe("given a trace whose older stored version does not match the filter", () => {
    /** @scenario "A filter reads only the latest version of each trace" */
    it("finds the trace by what its newest version says", async () => {
      const page = await listWith("annotation:annotated");

      expect(page.rows.map((row) => row.traceId)).toEqual([versionedTraceId]);
      expect(page.totalHits).toBe(1);
    });

    /** @scenario "A filter reads only the latest version of each trace" */
    it("does not find it by what its older version said", async () => {
      const page = await listWith("annotation:unannotated");

      expect(page.rows).toHaveLength(0);
      expect(page.totalHits).toBe(0);
    });

    /** @scenario "A filter reads only the latest version of each trace" */
    it("counts the trace exactly once, in the bucket its newest version is in", async () => {
      const counts = await repo.findFacetCounts({
        tenantId: versionTenant,
        timeRange,
        facetExpression: annotationFacetExpression,
      });

      expect(counts.values).toEqual({ annotated: 1 });
    });

    /** @scenario "A filter reads only the latest version of each trace" */
    it("counts nothing for the bucket only its older version is in", async () => {
      const counts = await repo.findFacetCounts({
        tenantId: versionTenant,
        timeRange,
        facetExpression: annotationFacetExpression,
        filterWhere: filterFor("annotation:unannotated"),
      });

      expect(counts.values).toEqual({});
    });
  });
});
