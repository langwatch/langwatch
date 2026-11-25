/**
 * @vitest-environment node
 * @integration
 * The Explorer's own filters on a migrated ClickHouse: the origins it hides by
 * default, and an eval chip read through a run's verdicts.
 * @see specs/traces-v2/origin-badge-filter.feature
 * @see specs/traces-v2/instant-eval-search.feature
 * @see specs/traces-v2/search.feature
 */
import type { ClickHouseClient } from "@clickhouse/client";
import {
  explorerHiddenOrigins,
  LANGY_TRACE_ORIGIN,
  type ResolvedInstantEvalRun,
} from "@langwatch/trace-contract";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ownProof } from "../../../__tests__/support/authorization-proofs.fixture.ts";
import { createInitState } from "../../../eventing/__tests__/trace-summary-test.fixtures.ts";
import {
  CLICKHOUSE_FACET_CATALOG,
  FACET_REGISTRY,
} from "../../../features/facet/repositories/clickhouse/clickhouse.trace-facet-registry.mapper.ts";
import { createFacetFilterResolver } from "../../../features/facet/rules/trace-facet-filter.rules.ts";
import { TraceListService } from "../../../features/read/services/trace-list-read.service.ts";
import {
  andFilterConditions,
  explorerOriginExclusion,
  findHiddenOriginConditions,
  type TraceFilterWhere,
} from "../../../rules/trace-filter-hidden-origins.rules.ts";
import {
  traceQueryEvaluation,
  traceQueryTranslation,
} from "../../../services/__tests__/fixtures/trace-query-services.fixtures.ts";
import { MemoryTraceEvaluationRunsRepository } from "../../memory/memory.trace-evaluation-runs.repository.ts";
import { TraceListClickHouseRepository } from "../trace-list.repository.ts";
import { authorizedClickHouseFor } from "./support/authorized-clickhouse.support.ts";
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
  models = ["gpt-5-mini"],
}: {
  tenantId: string;
  traceId: string;
  offset: number;
  attributes: Record<string, string>;
  containsErrorStatus?: boolean;
  models?: string[];
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
    Models: models,
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
  queryText,
  evalRuns,
}: {
  queryText: string;
  evalRuns?: ResolvedInstantEvalRun[];
}): TraceFilterWhere {
  const filter = traceQueryTranslation.translateFilter({
    queryText,
    timeRange,
    ...(evalRuns ? { evalRuns } : {}),
  });
  if (!filter) throw new Error(`"${queryText}" compiled to no filter`);
  return filter;
}

/** The Explorer's filter: the query's own conditions and the origins it hides. */
function explorerFilter({ query }: { query: string }): TraceFilterWhere {
  return andFilterConditions([
    ...(query ? [compiled({ queryText: query })] : []),
    ...findHiddenOriginConditions({ hiddenOrigins: explorerHiddenOrigins(query) }),
  ]);
}

function listWith({ tenantId, filterWhere }: { tenantId: string; filterWhere: TraceFilterWhere }) {
  return repo.listAll({
    authorization: ownProof({ projectId: tenantId }),
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
    authorization: ownProof({ projectId: tenantId }),
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
  repo = TraceListClickHouseRepository.create({ clickhouse: authorizedClickHouseFor(ch) });
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
        filterWhere: explorerFilter({ query: "" }),
      });

      expect(page.rows.map((row) => row.traceId)).toEqual([customerTraceId]);
      expect(page.totalHits).toBe(1);
    });

    /** @scenario "Picking Langy in the origin facet shows the turns" */
    it("lists only Langy's turn once the query asks for that origin", async () => {
      const page = await listWith({
        tenantId,
        filterWhere: explorerFilter({ query: "origin:langy" }),
      });

      expect(page.rows.map((row) => row.traceId)).toEqual([langyTraceId]);
      expect(page.totalHits).toBe(1);
    });

    /** @scenario "The list leaves out Langy's turns by default" */
    it("keeps a filter of its own and still hides the turn", async () => {
      const page = await listWith({
        tenantId,
        filterWhere: explorerFilter({ query: "status:ok" }),
      });

      expect(page.rows.map((row) => row.traceId)).toEqual([customerTraceId]);
    });

    /** @scenario "The list leaves out Langy's turns by default" */
    it("counts only the customer trace as new", async () => {
      const count = await repo.findCount({
        authorization: ownProof({ projectId: tenantId }),
        timeRange,
        since: base - 1,
        filterWhere: explorerFilter({ query: "" }),
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
  const skipped = "evalchip-skipped";
  let writtenAt = 0;

  const runOf = (id: string): ResolvedInstantEvalRun => ({
    question,
    target: "traces",
    runId: id,
    writtenFrom: writtenAt - 60_000,
    writtenUntil: writtenAt + 60_000,
  });

  const chipFilter = ({ query, run }: { query: string; run: string }) =>
    compiled({ queryText: query, evalRuns: [runOf(run)] });

  function judgment({
    tenant,
    run,
    traceId,
    passed,
  }: {
    tenant: string;
    run: string;
    traceId: string;
    /** null is a skipped or failed judgement, with no verdict. */
    passed: boolean | null;
  }) {
    let probability: number | null = null;
    if (passed !== null) probability = passed ? 0.9 : 0.1;
    return {
      TenantId: tenant,
      RunId: run,
      TraceId: traceId,
      QuestionId: "matched",
      ThreadId: "",
      SpanId: "",
      Kind: "boolean",
      Status: passed === null ? "skipped" : "judged",
      Passed: passed === null ? null : Number(passed),
      Score: null,
      Label: "",
      Probability: probability,
      Probabilities: "",
      Error: "",
      OccurredAt: new Date(base),
      CreatedAt: new Date(writtenAt),
      UpdatedAt: new Date(writtenAt),
    };
  }

  beforeAll(async () => {
    await insertTraces(
      [passedA, passedB, failed, unjudged, skipped].map((traceId, offset) =>
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
        judgment({ tenant: tenantId, run: runId, traceId: skipped, passed: null }),
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

    /** @scenario "A negated eval chip keeps the traces the judge did not match" */
    it("under NOT lists only the judged no, not a passed, skipped or unjudged trace", async () => {
      const page = await listWith({
        tenantId,
        filterWhere: chipFilter({ query: `NOT eval:"${question}"`, run: runId }),
      });

      expect(page.rows.map((row) => row.traceId)).toEqual([failed]);
      expect(page.totalHits).toBe(1);
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
    evaluationRuns: MemoryTraceEvaluationRunsRepository.create(),
    topicNames: { findNamesByIds: async () => new Map() },
  });
  const facets = await service.getFacets({
    authorization: ownProof({ projectId: tenantId }),
    timeRange,
    filterKey: query,
    filterFor: createFacetFilterResolver({
      queryText: query,
      compile: (text) =>
        traceQueryTranslation.translateFilter({ queryText: text, timeRange }) ?? undefined,
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
        filterWhere: explorerFilter({ query: "status:error AND service:api" }),
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
      const page = await listWith({ tenantId, filterWhere: explorerFilter({ query }) });
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

describe.skipIf(!clickHouseConfigured)("a NOT over a bracketed group on the trace list", () => {
  const tenantId = `test-not-group-${nanoid()}`;
  const traces = [
    { traceId: "ng-error-mini", isError: true, model: "gpt-5-mini" },
    { traceId: "ng-error-other", isError: true, model: "gpt-5" },
    { traceId: "ng-ok-mini", isError: false, model: "gpt-5-mini" },
    { traceId: "ng-ok-other", isError: false, model: "gpt-5" },
  ];

  beforeAll(async () => {
    await insertTraces(
      traces.map(({ traceId, isError, model }, offset) =>
        traceRow({
          tenantId,
          traceId,
          offset,
          attributes: { "service.name": "api" },
          containsErrorStatus: isError,
          models: [model],
        }),
      ),
    );
  }, 120_000);

  /** The same rows through the in-memory check automations use. */
  function matchedInMemory(query: string): string[] {
    return traces
      .filter(({ traceId, isError, model }) =>
        traceQueryEvaluation.traceMatchesQuery(query, {
          summary: {
            ...createInitState(),
            traceId,
            containsErrorStatus: isError,
            containsOKStatus: !isError,
            models: [model],
          },
        }),
      )
      .map(({ traceId }) => traceId)
      .toSorted();
  }

  afterAll(async () => {
    if (!ch) return;
    await ch.exec({
      query: "ALTER TABLE trace_summaries DELETE WHERE TenantId = {tenantId:String}",
      query_params: { tenantId },
    });
  });

  async function listed(query: string): Promise<{ ids: string[]; total: number }> {
    const page = await listWith({ tenantId, filterWhere: compiled({ queryText: query }) });
    return { ids: page.rows.map((r) => r.traceId).toSorted(), total: page.totalHits };
  }

  describe("given errors and non-errors on two models", () => {
    /** @scenario "The table lists exactly the complement of a group under NOT" */
    it("hides only the errors on the model for a NOT over an AND group", async () => {
      expect(await listed("NOT (status:error AND model:gpt-5-mini)")).toEqual({
        ids: ["ng-error-other", "ng-ok-mini", "ng-ok-other"],
        total: 3,
      });
    });

    /** @scenario "The table lists exactly the complement of a group under NOT" */
    it("hides every error and every trace on the model for a NOT over an OR group", async () => {
      expect(await listed("NOT (status:error OR model:gpt-5-mini)")).toEqual({
        ids: ["ng-ok-other"],
        total: 1,
      });
    });

    /** @scenario "The table lists exactly the complement of a group under NOT" */
    it.each([
      "NOT (status:error AND model:gpt-5-mini)",
      "NOT (status:error OR model:gpt-5-mini)",
      "NOT (NOT status:error AND model:gpt-5-mini)",
      "NOT ((status:error AND model:gpt-5-mini) OR model:gpt-5)",
      "NOT (NOT (status:error AND model:gpt-5-mini))",
    ])("lists the same traces the in-memory check matches for %s", async (query) => {
      expect((await listed(query)).ids).toEqual(matchedInMemory(query));
    });

    /** @scenario "The table lists exactly the complement of a group under NOT" */
    it.each([
      ["NOT (status:error AND model:gpt-5-mini)", 3],
      ["NOT (status:error OR model:gpt-5-mini)", 1],
    ])("counts %s in the sidebar as the table does", async (query, total) => {
      const counts = await sidebarCounts({ tenantId, query });
      expect(counts.get("service")?.api).toBe(total);
      expect((await listed(query)).total).toBe(total);
    });

    /** @scenario "A facet whose term an OR joins to other terms counts under the whole query" */
    it("counts the status facet over exactly the listed traces for a NOT over an AND group", async () => {
      const query = "NOT (status:error AND model:gpt-5-mini)";
      const counts = await sidebarCounts({ tenantId, query });
      expect(counts.get("status")).toEqual({ error: 1, ok: 2 });
    });

    /** @scenario "A facet whose term an OR joins to other terms counts under the whole query" */
    it("still drops the status terms for a NOT over an OR group, which ANDs them", async () => {
      const query = "NOT (status:error OR model:gpt-5-mini)";
      const counts = await sidebarCounts({ tenantId, query });
      expect(counts.get("status")).toEqual({ error: 1, ok: 1 });
      expect(counts.get("status")?.ok).toBe((await listed(query)).total);
    });
  });
});
