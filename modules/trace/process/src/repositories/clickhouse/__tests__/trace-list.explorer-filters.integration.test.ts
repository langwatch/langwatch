/**
 * @vitest-environment node
 * @integration
 * The Explorer's own filters on a migrated ClickHouse: the origins it hides by
 * default, and an eval chip read through a run's verdicts.
 * @see specs/traces-v2/origin-badge-filter.feature
 * @see specs/traces-v2/instant-eval-search.feature
 */
import type { ClickHouseClient } from "@clickhouse/client";
import type { EvaluationApi } from "@langwatch/evaluation-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { TopicApi } from "@langwatch/topic-contract";
import {
  explorerHiddenOrigins,
  LANGY_TRACE_ORIGIN,
  type ResolvedInstantEvalRun,
} from "@langwatch/trace-contract";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createFacetFilterResolver } from "../../../rules/trace-facet-filter.rules.ts";
import {
  andFilterConditions,
  explorerOriginExclusion,
  findHiddenOriginConditions,
  type TraceFilterWhere,
} from "../../../rules/trace-filter-hidden-origins.rules.ts";
import { translateFilter } from "../../../rules/trace-query.rules.ts";
import { TraceListService } from "../../../services/trace-list-read.service.ts";
import {
  CLICKHOUSE_FACET_CATALOG,
  FACET_REGISTRY,
} from "../clickhouse.trace-facet-registry.mapper.ts";
import { TraceListClickHouseRepository } from "../trace-list.repository.ts";
import {
  startMigratedTraceClickHouse,
  testClickHouseConfigured,
} from "./support/clickhouse-endpoint.support.ts";

const clickHouseConfigured = testClickHouseConfigured();

let ch: ClickHouseClient;
let repo: TraceListClickHouseRepository;

const base = Date.now() - 60 * 60 * 1000;
const timeRange = { from: base - 60_000, to: base + 60_000 };

function traceRow({
  tenantId,
  traceId,
  offset,
  attributes,
  containsErrorStatus = false,
}: {
  tenantId: string;
  traceId: string;
  offset: number;
  attributes: Record<string, string>;
  containsErrorStatus?: boolean;
}) {
  const at = new Date(base + offset);
  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: tenantId,
    TraceId: traceId,
    Version: "v1",
    Attributes: attributes,
    OccurredAt: at,
    CreatedAt: at,
    UpdatedAt: at,
    LastEventOccurredAt: at,
    ComputedIOSchemaVersion: "v1",
    ComputedInput: "hi",
    ComputedOutput: "done",
    TotalDurationMs: 100,
    SpanCount: 1,
    ContainsErrorStatus: containsErrorStatus,
    ContainsOKStatus: !containsErrorStatus,
    Models: ["gpt-5-mini"],
    TraceName: "checkout flow",
  };
}

async function insertTraces(rows: ReturnType<typeof traceRow>[]): Promise<void> {
  await ch.insert({
    table: "trace_summaries",
    values: rows,
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
}

function facetExpression(key: string): string {
  const facet = FACET_REGISTRY.find((entry) => entry.key === key);
  if (!facet || !("expression" in facet)) throw new Error(`the ${key} facet carries no expression`);
  return facet.expression;
}

function compiled({
  tenantId,
  queryText,
  evalRuns,
}: {
  tenantId: string;
  queryText: string;
  evalRuns?: ResolvedInstantEvalRun[];
}): TraceFilterWhere {
  const filter = translateFilter({
    queryText,
    tenantId,
    timeRange,
    ...(evalRuns ? { evalRuns } : {}),
  });
  if (!filter) throw new Error(`"${queryText}" compiled to no filter`);
  return filter;
}

/** The Explorer's filter: the query's own conditions and the origins it hides. */
function explorerFilter({
  tenantId,
  query,
}: {
  tenantId: string;
  query: string;
}): TraceFilterWhere {
  return andFilterConditions([
    ...(query ? [compiled({ tenantId, queryText: query })] : []),
    ...findHiddenOriginConditions({ hiddenOrigins: explorerHiddenOrigins(query) }),
  ]);
}

function listWith({ tenantId, filterWhere }: { tenantId: string; filterWhere: TraceFilterWhere }) {
  return repo.listAll({
    tenantId,
    timeRange,
    sort: { column: "OccurredAt", direction: "desc" },
    limit: 50,
    offset: 0,
    filterWhere,
  });
}

async function categoricalCounts({
  tenantId,
  key,
  filterWhere,
}: {
  tenantId: string;
  key: string;
  filterWhere?: TraceFilterWhere;
}): Promise<Record<string, number>> {
  const batch = await repo.findBatchedFacets({
    tenantId,
    timeRange,
    table: "trace_summaries",
    timeColumn: "OccurredAt",
    categoricalSpecs: [{ key, expression: facetExpression(key) }],
    rangeSpecs: [],
    topN: 10,
    ...(filterWhere ? { filterWhere } : {}),
  });
  return Object.fromEntries(
    (batch.categoricals[key]?.values ?? []).map((entry) => [entry.value, entry.count]),
  );
}

beforeAll(async () => {
  if (!clickHouseConfigured) return;
  ch = await startMigratedTraceClickHouse();
  repo = TraceListClickHouseRepository.create(async () => ch);
}, 120_000);

describe.skipIf(!clickHouseConfigured)("the Explorer's hidden origins on the trace list", () => {
  const tenantId = `test-hidden-origins-${nanoid()}`;
  const customerTraceId = "ho-customer";
  const langyTraceId = "ho-langy";

  beforeAll(async () => {
    await insertTraces([
      traceRow({ tenantId, traceId: customerTraceId, offset: 0, attributes: {} }),
      traceRow({
        tenantId,
        traceId: langyTraceId,
        offset: 1,
        attributes: { "langwatch.origin": LANGY_TRACE_ORIGIN },
      }),
    ]);
  }, 120_000);

  afterAll(async () => {
    if (!ch) return;
    await ch.exec({
      query: "ALTER TABLE trace_summaries DELETE WHERE TenantId = {tenantId:String}",
      query_params: { tenantId },
    });
  });

  describe("given one customer trace and one of Langy's own turns", () => {
    /** @scenario "The list leaves out Langy's turns by default" */
    it("lists only the customer trace with the default hidden origins", async () => {
      const page = await listWith({
        tenantId,
        filterWhere: explorerFilter({ tenantId, query: "" }),
      });

      expect(page.rows.map((row) => row.traceId)).toEqual([customerTraceId]);
      expect(page.totalHits).toBe(1);
    });

    /** @scenario "Picking Langy in the origin facet shows the turns" */
    it("lists only Langy's turn once the query asks for that origin", async () => {
      const page = await listWith({
        tenantId,
        filterWhere: explorerFilter({ tenantId, query: "origin:langy" }),
      });

      expect(page.rows.map((row) => row.traceId)).toEqual([langyTraceId]);
      expect(page.totalHits).toBe(1);
    });

    /** @scenario "The list leaves out Langy's turns by default" */
    it("keeps a filter of its own and still hides the turn", async () => {
      const page = await listWith({
        tenantId,
        filterWhere: explorerFilter({ tenantId, query: "status:ok" }),
      });

      expect(page.rows.map((row) => row.traceId)).toEqual([customerTraceId]);
    });

    /** @scenario "The list leaves out Langy's turns by default" */
    it("counts only the customer trace as new", async () => {
      const count = await repo.findCount({
        tenantId,
        timeRange,
        since: base - 1,
        filterWhere: explorerFilter({ tenantId, query: "" }),
      });

      expect(count).toBe(1);
    });

    /** @scenario "The origin facet still offers Langy" */
    it("counts both origins in the origin facet when read without the exclusion", async () => {
      expect(await categoricalCounts({ tenantId, key: "origin" })).toEqual({
        application: 1,
        langy: 1,
      });
    });
  });
});

describe.skipIf(!clickHouseConfigured)("an eval chip on the trace list", () => {
  const tenantId = `test-eval-chip-${nanoid()}`;
  const otherTenantId = `test-eval-chip-other-${nanoid()}`;
  const question = "the user is annoyed";
  const runId = `instanteval_${nanoid()}`;
  const foreignRunId = `instanteval_${nanoid()}`;
  const passedA = "evalchip-passed-a";
  const passedB = "evalchip-passed-b";
  const failed = "evalchip-failed";
  const unjudged = "evalchip-unjudged";
  let writtenAt = 0;

  const runOf = (id: string): ResolvedInstantEvalRun => ({
    question,
    target: "traces",
    runId: id,
    writtenFrom: writtenAt - 60_000,
    writtenUntil: writtenAt + 60_000,
  });

  const chipFilter = ({ query, run }: { query: string; run: string }) =>
    compiled({ tenantId, queryText: query, evalRuns: [runOf(run)] });

  function judgment({
    tenant,
    run,
    traceId,
    passed,
  }: {
    tenant: string;
    run: string;
    traceId: string;
    passed: boolean;
  }) {
    return {
      TenantId: tenant,
      RunId: run,
      TraceId: traceId,
      QuestionId: "matched",
      ThreadId: "",
      SpanId: "",
      Kind: "boolean",
      Status: "judged",
      Passed: passed ? 1 : 0,
      Score: null,
      Label: "",
      Probability: passed ? 0.9 : 0.1,
      Probabilities: "",
      Error: "",
      OccurredAt: new Date(base),
      CreatedAt: new Date(writtenAt),
      UpdatedAt: new Date(writtenAt),
    };
  }

  beforeAll(async () => {
    await insertTraces(
      [passedA, passedB, failed, unjudged].map((traceId, offset) =>
        traceRow({
          tenantId,
          traceId,
          offset,
          attributes: { "service.name": traceId === failed ? "worker" : "api" },
        }),
      ),
    );
    // A run over an old window writes its verdicts at judging time, not trace time.
    writtenAt = Date.now();
    await ch.insert({
      table: "instant_eval_judgments",
      values: [
        judgment({ tenant: tenantId, run: runId, traceId: passedA, passed: true }),
        judgment({ tenant: tenantId, run: runId, traceId: passedB, passed: true }),
        judgment({ tenant: tenantId, run: runId, traceId: failed, passed: false }),
        judgment({ tenant: otherTenantId, run: foreignRunId, traceId: passedA, passed: true }),
      ],
      format: "JSONEachRow",
      clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
    });
  }, 120_000);

  afterAll(async () => {
    if (!ch) return;
    await ch.exec({
      query: "ALTER TABLE trace_summaries DELETE WHERE TenantId = {tenantId:String}",
      query_params: { tenantId },
    });
    for (const tenant of [tenantId, otherTenantId]) {
      await ch.exec({
        query: "ALTER TABLE instant_eval_judgments DELETE WHERE TenantId = {tenantId:String}",
        query_params: { tenantId: tenant },
      });
    }
  });

  describe("given a run of the project with judgements on three traces", () => {
    it("lists the two passed traces, and the sidebar counts the same two", async () => {
      const filterWhere = chipFilter({ query: `eval:"${question}"`, run: runId });
      const page = await listWith({ tenantId, filterWhere });

      expect(page.totalHits).toBe(2);
      expect(page.rows.map((row) => row.traceId).toSorted()).toEqual([passedA, passedB]);
      expect(await categoricalCounts({ tenantId, key: "service", filterWhere })).toEqual({
        api: 2,
      });
    });

    it("keeps the other chips in force beside the eval chip", async () => {
      const page = await listWith({
        tenantId,
        filterWhere: chipFilter({ query: `service:worker AND eval:"${question}"`, run: runId }),
      });

      expect(page.totalHits).toBe(0);
    });
  });

  describe("given a run whose verdicts belong to another project", () => {
    it("lists no traces", async () => {
      const page = await listWith({
        tenantId,
        filterWhere: chipFilter({ query: `eval:"${question}"`, run: foreignRunId }),
      });

      expect(page.totalHits).toBe(0);
    });
  });
});

/** The sidebar's counts as the app composes them, over the real trace list store. */
async function sidebarCounts({
  tenantId,
  query,
}: {
  tenantId: string;
  query: string;
}): Promise<Map<string, Record<string, number>>> {
  const service = TraceListService.create({
    discoverUpdates: { publishProjectEvent: async () => {} },
    facets: CLICKHOUSE_FACET_CATALOG,
    repository: repo,
    evaluations: createApiFixture<EvaluationApi>({}),
    topicService: createApiFixture<TopicApi>({ getNamesByIds: async () => new Map() }),
  });
  const facets = await service.getFacets({
    tenantId,
    timeRange,
    filterFor: createFacetFilterResolver({
      queryText: query,
      compile: (text) => translateFilter({ queryText: text, tenantId, timeRange }) ?? undefined,
      hide: explorerOriginExclusion({ hiddenOrigins: explorerHiddenOrigins(query) }),
    }),
  });
  const counts = new Map<string, Record<string, number>>();
  for (const facet of facets) {
    if (facet.kind !== "categorical") continue;
    counts.set(
      facet.key,
      Object.fromEntries(facet.topValues.map((entry) => [entry.value, entry.count])),
    );
  }
  return counts;
}

describe.skipIf(!clickHouseConfigured)("the sidebar's counts against the table", () => {
  const tenantId = `test-facet-table-${nanoid()}`;

  beforeAll(async () => {
    const trace = (traceId: string, offset: number, service: string, error: boolean) =>
      traceRow({
        tenantId,
        traceId,
        offset,
        attributes: { "service.name": service },
        containsErrorStatus: error,
      });
    await insertTraces([
      trace("ft-api-error-1", 0, "api", true),
      trace("ft-api-error-2", 1, "api", true),
      trace("ft-web-error", 2, "web", true),
      trace("ft-api-ok", 3, "api", false),
    ]);
  }, 120_000);

  afterAll(async () => {
    if (!ch) return;
    await ch.exec({
      query: "ALTER TABLE trace_summaries DELETE WHERE TenantId = {tenantId:String}",
      query_params: { tenantId },
    });
  });

  describe("given Error is checked under Status and the Service facet shows api", () => {
    /** @scenario "A facet value's count equals the table count after selecting it" */
    it("shows a table total equal to that count once api is checked", async () => {
      const before = await sidebarCounts({ tenantId, query: "status:error" });
      const apiCount = before.get("service")?.api;
      expect(apiCount).toBe(2);

      const page = await listWith({
        tenantId,
        filterWhere: explorerFilter({ tenantId, query: "status:error AND service:api" }),
      });

      expect(page.totalHits).toBe(apiCount);
    });
  });

  describe("given a query that matches no trace", () => {
    /** @scenario "Facets show nothing under a query the table answers with zero traces" */
    it("shows no traces and no count on a facet the query does not name", async () => {
      const everything = await sidebarCounts({ tenantId, query: "" });
      expect(everything.get("status")).toEqual({ error: 3, ok: 1 });

      const query = "service:nobody";
      const page = await listWith({ tenantId, filterWhere: explorerFilter({ tenantId, query }) });
      expect(page.totalHits).toBe(0);

      const counts = await sidebarCounts({ tenantId, query });
      const shown = [...counts]
        .filter(([key]) => key !== "service")
        .flatMap(([key, values]) => Object.values(values).map((count) => [key, count] as const))
        .filter(([, count]) => count > 0);
      expect(shown).toEqual([]);
    });
  });
});
