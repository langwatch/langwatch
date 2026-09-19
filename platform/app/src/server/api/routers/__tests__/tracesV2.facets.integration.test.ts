/**
 * @vitest-environment node
 *
 * `tracesV2.facets` and `tracesV2.list` through the real tRPC router on a
 * real ClickHouse: the sidebar's counts and the table's total answer the same
 * predicate. A facet value's count is the total the list returns with that
 * value selected; a query the list answers with zero traces leaves every
 * facet it does not name without a count; Langy's origin and the traces
 * outside the window are left out of both.
 *
 * Spec: specs/traces-v2/search.feature ("Facet count updates").
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { globalForApp, resetApp } from "~/server/app-layer/app";
import { EvaluationRunService } from "~/server/app-layer/evaluations/evaluation-run.service";
import { NullEvaluationRunRepository } from "~/server/app-layer/evaluations/repositories/evaluation-run.repository";
import { createTestApp } from "~/server/app-layer/presets";
import { NullTopicRepository } from "~/server/app-layer/topic-clustering/repositories/null-topic.repository";
import { TopicService } from "~/server/app-layer/topic-clustering/topic.service";
import { LANGY_TRACE_ORIGIN } from "~/server/app-layer/traces/derive-trace-origin";
import { TraceListClickHouseRepository } from "~/server/app-layer/traces/repositories/trace-list.clickhouse.repository";
import { TraceListService } from "~/server/app-layer/traces/trace-list.service";
import {
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";
import { getTestUser } from "../../../../utils/testUtils";
import { appRouter } from "../../root";
import { createInnerTRPCContext } from "../../trpc";

const PROJECT_ID = "test-project-id";
// A window of its own, far from every other suite seeding this tenant.
const DAY_MS = 24 * 60 * 60 * 1000;
const base =
  Date.UTC(2021, 0, 1) +
  Math.floor(Math.random() * 3_000) * DAY_MS +
  Math.floor(Math.random() * 20) * 60 * 60 * 1000;
const WINDOW = { from: base - 60_000, to: base + 60_000 };

const run = nanoid();
const ERROR_API_GPT = `facets-${run}-error-api-gpt`;
const ERROR_WORKER_GPT = `facets-${run}-error-worker-gpt`;
const OK_API_CLAUDE = `facets-${run}-ok-api-claude`;
const LANGY_ERROR_API = `facets-${run}-langy`;
const OUTSIDE_WINDOW = `facets-${run}-outside`;
const ALL_IDS = [
  ERROR_API_GPT,
  ERROR_WORKER_GPT,
  OK_API_CLAUDE,
  LANGY_ERROR_API,
  OUTSIDE_WINDOW,
];

function traceRow({
  traceId,
  failed,
  service,
  model,
  origin,
  occurredAt = base,
}: {
  traceId: string;
  failed: boolean;
  service: string;
  model: string;
  origin?: string;
  occurredAt?: number;
}) {
  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: PROJECT_ID,
    TraceId: traceId,
    Version: "v1",
    Attributes: {
      "service.name": service,
      ...(origin ? { "langwatch.origin": origin } : {}),
    },
    OccurredAt: new Date(occurredAt),
    CreatedAt: new Date(occurredAt),
    UpdatedAt: new Date(occurredAt),
    LastEventOccurredAt: new Date(occurredAt),
    ComputedIOSchemaVersion: "v1",
    ComputedInput: JSON.stringify({ type: "text", value: "hi" }),
    ComputedOutput: JSON.stringify({ type: "text", value: "done" }),
    TotalDurationMs: 100,
    SpanCount: 1,
    ContainsErrorStatus: failed,
    ContainsOKStatus: !failed,
    Models: [model],
    TraceName: "checkout flow",
  };
}

type Facets = Awaited<
  ReturnType<ReturnType<typeof appRouter.createCaller>["tracesV2"]["facets"]>
>["facets"];

function valuesOf(facets: Facets, key: string): Record<string, number> {
  const facet = facets.find((f) => f.key === key);
  if (facet?.kind !== "categorical") return {};
  return Object.fromEntries(facet.topValues.map((v) => [v.value, v.count]));
}

let ch: ClickHouseClient;
let caller: ReturnType<typeof appRouter.createCaller>;

const facetsFor = (query?: string) =>
  caller.tracesV2
    .facets({ projectId: PROJECT_ID, timeRange: WINDOW, query })
    .then((r) => r.facets);

const totalFor = (query?: string) =>
  caller.tracesV2
    .list({
      projectId: PROJECT_ID,
      timeRange: WINDOW,
      sort: { columnId: "timestamp", direction: "desc" },
      page: 1,
      pageSize: 50,
      query,
    })
    .then((page) => page.totalHits);

beforeAll(async () => {
  const containers = await startTestContainers();
  ch = containers.clickHouseClient;

  const defaults = createTestApp();
  globalForApp.__langwatch_app = createTestApp({
    traces: {
      ...defaults.traces,
      list: new TraceListService(
        new TraceListClickHouseRepository(async () => ch),
        new EvaluationRunService(new NullEvaluationRunRepository()),
        new TopicService(new NullTopicRepository()),
      ),
    },
  });

  const user = await getTestUser();
  caller = appRouter.createCaller(
    createInnerTRPCContext({
      session: { user: { id: user.id }, expires: "1" },
    }),
  );

  await ch.insert({
    table: "trace_summaries",
    values: [
      traceRow({
        traceId: ERROR_API_GPT,
        failed: true,
        service: "api",
        model: "gpt-4o",
      }),
      traceRow({
        traceId: ERROR_WORKER_GPT,
        failed: true,
        service: "worker",
        model: "gpt-4o",
      }),
      traceRow({
        traceId: OK_API_CLAUDE,
        failed: false,
        service: "api",
        model: "claude",
      }),
      traceRow({
        traceId: LANGY_ERROR_API,
        failed: true,
        service: "api",
        model: "gpt-4o",
        origin: LANGY_TRACE_ORIGIN,
      }),
      traceRow({
        traceId: OUTSIDE_WINDOW,
        failed: true,
        service: "api",
        model: "gpt-4o",
        occurredAt: base - DAY_MS,
      }),
    ],
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
}, 120_000);

afterAll(async () => {
  if (ch) {
    await ch.exec({
      query:
        "ALTER TABLE trace_summaries DELETE WHERE TenantId = {tenantId:String} AND TraceId IN ({ids:Array(String)})",
      query_params: { tenantId: PROJECT_ID, ids: ALL_IDS },
    });
  }
  await resetApp();
  await stopTestContainers();
});

describe("tracesV2.facets", () => {
  describe("given a query on the status field", () => {
    /** @scenario "Facet counts update when a filter is applied" */
    it("counts the other facets under the query", async () => {
      const facets = await facetsFor("status:error");
      expect(valuesOf(facets, "service")).toEqual({ api: 1, worker: 1 });
      expect(valuesOf(facets, "model")).toEqual({ "gpt-4o": 2 });
    });

    /** @scenario "Facet counts show how many results another filter would yield" */
    it("keeps the status facet's other values, counted without the status term", async () => {
      const facets = await facetsFor("status:error");
      expect(valuesOf(facets, "status")).toEqual({ error: 2, ok: 1 });
    });

    /** @scenario "A facet value's count equals the table count after selecting it" */
    it("counts each service value as the list would with it selected", async () => {
      const facets = await facetsFor("status:error");
      const services = valuesOf(facets, "service");
      expect(Object.keys(services).length).toBeGreaterThan(0);
      for (const [service, count] of Object.entries(services)) {
        expect(await totalFor(`status:error AND service:${service}`)).toBe(
          count,
        );
      }
      const models = valuesOf(facets, "model");
      for (const [model, count] of Object.entries(models)) {
        expect(await totalFor(`status:error AND model:${model}`)).toBe(count);
      }
    });
  });

  describe("given a query the list answers with zero traces", () => {
    const query = "status:error AND service:nowhere";

    /** @scenario "Facets show nothing under a query the table answers with zero traces" */
    it("leaves every facet the query does not name without a count", async () => {
      expect(await totalFor(query)).toBe(0);
      const facets = await facetsFor(query);
      for (const facet of facets) {
        if (facet.key === "status" || facet.key === "service") continue;
        if (facet.kind !== "categorical") continue;
        expect(facet.topValues.map((v) => v.count)).toEqual(
          facet.topValues.map(() => 0),
        );
        expect(facet.topValues).toEqual([]);
      }
    });

    it("still offers the named facets' other values", async () => {
      const facets = await facetsFor(query);
      expect(valuesOf(facets, "service")).toEqual({ api: 1, worker: 1 });
      expect(valuesOf(facets, "status")).toEqual({});
    });
  });

  describe("given Langy's own trace and a trace outside the window", () => {
    /** @scenario "Facet counts leave out the hidden origin and the traces outside the window" */
    it("counts neither in the status facet, and the list agrees", async () => {
      const facets = await facetsFor();
      expect(valuesOf(facets, "status")).toEqual({ error: 2, ok: 1 });
      expect(await totalFor()).toBe(3);
    });

    /** @scenario "Facet counts leave out the hidden origin and the traces outside the window" */
    it("keeps Langy on offer in the origin facet", async () => {
      const facets = await facetsFor();
      expect(valuesOf(facets, "origin")).toEqual({
        application: 3,
        [LANGY_TRACE_ORIGIN]: 1,
      });
    });

    it("counts Langy's trace once the query names its origin, and the list agrees", async () => {
      const query = `origin:${LANGY_TRACE_ORIGIN}`;
      const facets = await facetsFor(query);
      expect(valuesOf(facets, "status")).toEqual({ error: 1 });
      expect(await totalFor(query)).toBe(1);
    });
  });
});
