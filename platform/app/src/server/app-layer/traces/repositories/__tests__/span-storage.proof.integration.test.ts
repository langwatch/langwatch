/**
 * ADR-144 block C, rung 4: the span storage repository reads through the
 * authorization proof. Against a real ClickHouse on the production
 * `stored_spans` schema, with proofs sealed the way the authorizer seals
 * them, so the fence the client applies is the one a route would carry.
 *
 * Every tenant holds spans under the same trace id: two member projects can
 * legitimately share one, and the dedup tuple is what keeps them apart. A
 * read that leaked would show a span named after a project the proof does
 * not cover.
 *
 * Spec: specs/governance/aggregate-project.feature, section C.
 */

import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuthorizedClickHouse } from "~/server/app-layer/clients/clickhouse/authorized-reads";
import { listedTraceKey } from "~/shared/traces/listedTraceKey";
import { aggregateProof, ownProof } from "~/test-utils/authorizationProofs";
import {
  startTestContainers,
  stopTestContainers,
} from "../../../../event-sourcing/__tests__/integration/testContainers";
import { SpanStorageClickHouseRepository } from "../span-storage.clickhouse.repository";

const run = nanoid();
const AGGREGATE = `span-proof-aggregate-${run}`;
const MEMBER_A = `span-proof-member-a-${run}`;
const MEMBER_B = `span-proof-member-b-${run}`;
const OUTSIDER = `span-proof-outsider-${run}`;
const PLAIN = `span-proof-plain-${run}`;

/** One trace id every tenant writes under. */
const SHARED_TRACE = `shared-trace-${run}`;
/** The member trace split across the grant's from date. */
const A_TRACE = `a-trace-${run}`;
const PLAIN_TRACE = `plain-trace-${run}`;
const PLAIN_SPANS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;
/**
 * The clock every proof and row is minted against. Taken once the containers
 * are up, not at import: a proof expires AUTHORIZATION_MAX_AGE_MS after its
 * `now`, and a cold shard can spend longer than that starting ClickHouse.
 */
let NOW: number;
let TODAY: number;
let YESTERDAY: number;
let B_WINDOW: { from: number; until: number };
/** The list window the rollup read is handed. */
let WINDOW: { from: number; to: number };

function takeClock(): void {
  NOW = Date.now();
  TODAY = NOW - 60 * 60 * 1000;
  YESTERDAY = TODAY - DAY_MS;
  B_WINDOW = {
    from: TODAY - 10 * 60 * 1000,
    until: TODAY + 10 * 60 * 1000,
  };
  WINDOW = { from: YESTERDAY - DAY_MS, to: NOW + DAY_MS };
}

let ch: ClickHouseClient;
let repo: SpanStorageClickHouseRepository;

function spanRow({
  tenantId,
  traceId,
  spanId,
  startTime,
}: {
  tenantId: string;
  traceId: string;
  spanId: string;
  startTime: number;
}) {
  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: tenantId,
    TraceId: traceId,
    SpanId: spanId,
    ParentSpanId: null,
    ParentTraceId: null,
    ParentIsRemote: null,
    Sampled: 1,
    StartTime: new Date(startTime),
    EndTime: new Date(startTime + 50),
    DurationMs: 50,
    SpanName: `span-of-${tenantId}`,
    SpanKind: 1,
    ServiceName: "test-service",
    ResourceAttributes: { "service.name": `service-of-${tenantId}` },
    SpanAttributes: {
      "gen_ai.request.model": `model-of-${tenantId}`,
      "langwatch.prompt.id": "prompt-1",
    },
    StatusCode: 1,
    StatusMessage: null,
    ScopeName: "test",
    ScopeVersion: null,
    "Events.Timestamp": [new Date(startTime + 1)],
    "Events.Name": [`event-of-${tenantId}`],
    "Events.Attributes": [{}] as Record<string, string>[],
    "Links.TraceId": [] as string[],
    "Links.SpanId": [] as string[],
    "Links.Attributes": [] as Record<string, string>[],
    DroppedAttributesCount: 0,
    DroppedEventsCount: 0,
    DroppedLinksCount: 0,
    CreatedAt: new Date(startTime),
    UpdatedAt: new Date(startTime),
  };
}

async function insert(rows: ReturnType<typeof spanRow>[]) {
  await ch.insert({
    table: "stored_spans",
    values: rows,
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
}

const aggregateReadsAandB = () =>
  aggregateProof({
    projectId: AGGREGATE,
    members: [
      { projectId: MEMBER_A, from: 0 },
      { projectId: MEMBER_B, from: B_WINDOW.from, until: B_WINDOW.until },
    ],
    now: NOW,
  });

beforeAll(async () => {
  const containers = await startTestContainers();
  takeClock();
  ch = containers.clickHouseClient;
  repo = new SpanStorageClickHouseRepository({
    resolveClient: async () => ch,
    clickhouse: new AuthorizedClickHouse({ resolveClient: async () => ch }),
  });

  await insert([
    spanRow({
      tenantId: AGGREGATE,
      traceId: SHARED_TRACE,
      spanId: "agg-1",
      startTime: TODAY,
    }),
    spanRow({
      tenantId: MEMBER_A,
      traceId: SHARED_TRACE,
      spanId: "a-1",
      startTime: TODAY + 1,
    }),
    spanRow({
      tenantId: MEMBER_B,
      traceId: SHARED_TRACE,
      spanId: "b-in",
      startTime: TODAY + 2,
    }),
    spanRow({
      tenantId: MEMBER_B,
      traceId: SHARED_TRACE,
      spanId: "b-outside",
      startTime: B_WINDOW.until + 60 * 1000,
    }),
    spanRow({
      tenantId: OUTSIDER,
      traceId: SHARED_TRACE,
      spanId: "out-1",
      startTime: TODAY + 3,
    }),
    spanRow({
      tenantId: OUTSIDER,
      traceId: SHARED_TRACE,
      spanId: "out-2",
      startTime: TODAY + 4,
    }),
    spanRow({
      tenantId: MEMBER_A,
      traceId: A_TRACE,
      spanId: "a-yesterday",
      startTime: YESTERDAY,
    }),
    spanRow({
      tenantId: MEMBER_A,
      traceId: A_TRACE,
      spanId: "a-today",
      startTime: TODAY + 5,
    }),
    ...Array.from({ length: PLAIN_SPANS }, (_, i) =>
      spanRow({
        tenantId: PLAIN,
        traceId: PLAIN_TRACE,
        spanId: `plain-${String(i).padStart(3, "0")}`,
        startTime: TODAY + i * 7,
      }),
    ),
  ]);
}, 120_000);

afterAll(async () => {
  await stopTestContainers();
});

describe("SpanStorageClickHouseRepository through the proof", () => {
  describe("given a proof with own grant on the aggregate and shared grants on members A and B", () => {
    describe("when a fourth project holds spans under the same trace id", () => {
      // @scenario "A project outside the proof contributes nothing"
      it("returns the spans of the aggregate and its members and none of the outsider's", async () => {
        const authorization = aggregateReadsAandB();

        const spans = await repo.getSpansByTraceId({
          authorization,
          traceId: SHARED_TRACE,
          occurredAtMs: TODAY,
        });
        expect(spans.map((span) => span.span_id).sort()).toEqual([
          "a-1",
          "agg-1",
          "b-in",
        ]);

        const page = await repo.findSpanSummariesPage({
          authorization,
          traceId: SHARED_TRACE,
          limit: 50,
          occurredAtMs: TODAY,
        });
        expect(page.rows.map((row) => row.spanId).sort()).toEqual([
          "a-1",
          "agg-1",
          "b-in",
        ]);
        expect(page.hasMore).toBe(false);

        const summary = await repo.getSpanSummaryByTraceId({
          authorization,
          traceId: SHARED_TRACE,
          occurredAtMs: TODAY,
        });
        expect(summary.map((row) => row.spanId).sort()).toEqual([
          "a-1",
          "agg-1",
          "b-in",
        ]);

        const rollups = await repo.getTraceEventRollupsByTraceIds({
          authorization,
          traceIds: [SHARED_TRACE],
          timeRange: WINDOW,
        });
        expect(
          rollups[
            listedTraceKey({ projectId: OUTSIDER, traceId: SHARED_TRACE })
          ],
        ).toBeUndefined();

        const models = await repo.findModelUsageStats({
          authorization,
          fromMs: WINDOW.from,
          limit: 50,
        });
        const modelNames = models.map((row) => row.model);
        expect(modelNames).toEqual(
          expect.arrayContaining([
            `model-of-${AGGREGATE}`,
            `model-of-${MEMBER_A}`,
            `model-of-${MEMBER_B}`,
          ]),
        );
        expect(modelNames).not.toContain(`model-of-${OUTSIDER}`);
      });
    });
  });

  describe("given two members and the aggregate each holding a trace under the same id", () => {
    describe("when the aggregate reads the page's event rollups", () => {
      /** @scenario "Two members with the same trace id each list their own events" */
      it("keeps each project's events on its own row", async () => {
        const rollups = await repo.getTraceEventRollupsByTraceIds({
          authorization: aggregateReadsAandB(),
          traceIds: [SHARED_TRACE],
          timeRange: WINDOW,
        });

        const rollupOf = (projectId: string) =>
          rollups[listedTraceKey({ projectId, traceId: SHARED_TRACE })];
        expect(Object.keys(rollups).sort()).toEqual(
          [AGGREGATE, MEMBER_A, MEMBER_B]
            .map((projectId) =>
              listedTraceKey({ projectId, traceId: SHARED_TRACE }),
            )
            .sort(),
        );
        for (const projectId of [AGGREGATE, MEMBER_A, MEMBER_B]) {
          expect(rollupOf(projectId)).toEqual({
            names: [
              {
                name: `event-of-${projectId}`,
                count: 1,
                firstTimestamp: expect.any(Number),
              },
            ],
            totalCount: 1,
            distinctCount: 1,
          });
        }
      });
    });
  });

  describe("given a member grant whose from date is today", () => {
    describe("when the aggregate reads the member's trace", () => {
      // @scenario "A trace written before the grant's from date is not shared"
      it("returns today's span and not yesterday's", async () => {
        const authorization = aggregateProof({
          projectId: AGGREGATE,
          members: [{ projectId: MEMBER_A, from: TODAY }],
          now: NOW,
        });

        const spans = await repo.getSpansByTraceId({
          authorization,
          traceId: A_TRACE,
          occurredAtMs: TODAY,
        });
        expect(spans.map((span) => span.span_id)).toEqual(["a-today"]);

        const page = await repo.findSpanSummariesPage({
          authorization,
          traceId: A_TRACE,
          limit: 50,
          occurredAtMs: TODAY,
        });
        expect(page.rows.map((row) => row.spanId)).toEqual(["a-today"]);
      });
    });
  });

  describe("given a plain project with no shared grants", () => {
    describe("when it reads its trace through an own-only proof", () => {
      // @scenario "A plain project reads the same rows as before"
      it("returns the same span ids in the same order as a direct tenant query", async () => {
        const authorization = ownProof({ projectId: PLAIN, now: NOW });

        // No hint: the read resolves the trace's time through
        // `trace_summaries` first, so that statement carries the fence too.
        const viaProof = await repo.getSpansByTraceId({
          authorization,
          traceId: PLAIN_TRACE,
        });

        const direct = await ch.query({
          query: `
            SELECT SpanId
            FROM stored_spans
            WHERE TenantId = {tenantId:String}
              AND TraceId = {traceId:String}
            ORDER BY StartTime ASC
          `,
          query_params: { tenantId: PLAIN, traceId: PLAIN_TRACE },
          format: "JSONEachRow",
        });
        const directIds = (await direct.json<{ SpanId: string }>()).map(
          (row) => row.SpanId,
        );

        expect(directIds).toHaveLength(PLAIN_SPANS);
        expect(viaProof.map((span) => span.span_id)).toEqual(directIds);
      });
    });
  });
});
