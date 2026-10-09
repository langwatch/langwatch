/**
 * ADR-175: span storage reads through the proof against real ClickHouse and the tenant guard.
 * Every tenant writes under one trace id, so a leak shows a span named after an uncovered
 * project. Spec: specs/governance/aggregate-project.feature, section C.
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { aggregateProof, ownProof } from "@langwatch/authorization/testing";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SpanStorageClickHouseRepository } from "../span-storage.repository.ts";
import { authorizedReadsOver } from "./support/authorized-reads.support.ts";
import {
  startMigratedTraceClickHouse,
  testClickHouseConfigured,
} from "./support/clickhouse-endpoint.support.ts";

const clickHouseConfigured = testClickHouseConfigured();

const run = nanoid();
const AGGREGATE = `span-proof-aggregate-${run}`;
const MEMBER_A = `span-proof-member-a-${run}`;
const MEMBER_B = `span-proof-member-b-${run}`;
const OUTSIDER = `span-proof-outsider-${run}`;
const PLAIN = `span-proof-plain-${run}`;
const TENANTS = [AGGREGATE, MEMBER_A, MEMBER_B, OUTSIDER, PLAIN];

/** One trace id every tenant writes under. */
const SHARED_TRACE = `shared-trace-${run}`;
/** The member trace split across the grant's from date. */
const A_TRACE = `a-trace-${run}`;
const PLAIN_TRACE = `plain-trace-${run}`;
const PLAIN_SPANS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;
/**
 * The clock every proof and row is minted against, taken once ClickHouse is up: a proof
 * expires minutes after its `now`, and a cold start can take longer than that.
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
  B_WINDOW = { from: TODAY - 10 * 60 * 1000, until: TODAY + 10 * 60 * 1000 };
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
  if (!clickHouseConfigured) return;
  ch = await startMigratedTraceClickHouse();
  takeClock();
  repo = SpanStorageClickHouseRepository.create({
    resolveClient: async () => ch,
    reads: authorizedReadsOver(ch),
  });

  await ch.insert({
    table: "stored_spans",
    values: [
      spanRow({ tenantId: AGGREGATE, traceId: SHARED_TRACE, spanId: "agg-1", startTime: TODAY }),
      spanRow({ tenantId: MEMBER_A, traceId: SHARED_TRACE, spanId: "a-1", startTime: TODAY + 1 }),
      spanRow({ tenantId: MEMBER_B, traceId: SHARED_TRACE, spanId: "b-in", startTime: TODAY + 2 }),
      spanRow({
        tenantId: MEMBER_B,
        traceId: SHARED_TRACE,
        spanId: "b-outside",
        startTime: B_WINDOW.until + 60 * 1000,
      }),
      spanRow({ tenantId: OUTSIDER, traceId: SHARED_TRACE, spanId: "out-1", startTime: TODAY + 3 }),
      spanRow({ tenantId: OUTSIDER, traceId: SHARED_TRACE, spanId: "out-2", startTime: TODAY + 4 }),
      spanRow({
        tenantId: MEMBER_A,
        traceId: A_TRACE,
        spanId: "a-yesterday",
        startTime: YESTERDAY,
      }),
      spanRow({ tenantId: MEMBER_A, traceId: A_TRACE, spanId: "a-today", startTime: TODAY + 5 }),
      ...Array.from({ length: PLAIN_SPANS }, (_, i) =>
        spanRow({
          tenantId: PLAIN,
          traceId: PLAIN_TRACE,
          spanId: `plain-${String(i).padStart(3, "0")}`,
          startTime: TODAY + i * 7,
        }),
      ),
    ],
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
}, 120_000);

afterAll(async () => {
  if (!ch) return;
  for (const tenantId of TENANTS) {
    await ch.exec({
      query: "ALTER TABLE stored_spans DELETE WHERE TenantId = {tenantId:String}",
      query_params: { tenantId },
    });
  }
});

describe.skipIf(!clickHouseConfigured)("SpanStorageClickHouseRepository through the proof", () => {
  describe("given a proof with own grant on the aggregate and shared grants on members A and B", () => {
    describe("when a fourth project holds spans under the same trace id", () => {
      /** @scenario "A project outside the proof contributes nothing" */
      it("returns the spans of the aggregate and its members and none of the outsider's", async () => {
        const authorization = aggregateReadsAandB();
        const byTrace = { authorization, traceId: SHARED_TRACE, occurredAtMs: TODAY };

        const spans = await repo.findSpansByTraceId(byTrace);
        expect(spans.map((span) => span.span_id).toSorted()).toEqual(["a-1", "agg-1", "b-in"]);

        const page = await repo.listSpansPaginated({ ...byTrace, limit: 50, offset: 0 });
        expect(page.spans.map((span) => span.span_id).toSorted()).toEqual(["a-1", "agg-1", "b-in"]);

        const summary = await repo.findSpanSummaryByTraceId(byTrace);
        expect(summary.map((row) => row.spanId).toSorted()).toEqual(["a-1", "agg-1", "b-in"]);

        const rollups = await repo.findTraceEventRollupsByTraceIds({
          authorization,
          traceIds: [SHARED_TRACE],
          timeRange: WINDOW,
        });
        const eventNames = rollups[SHARED_TRACE]?.names.map((entry) => entry.name) ?? [];
        expect(eventNames.length).toBeGreaterThan(0);
        expect(eventNames).not.toContain(`event-of-${OUTSIDER}`);

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

  describe("given a member grant whose from date is today", () => {
    describe("when the aggregate reads the member's trace", () => {
      /** @scenario "A trace written before the grant's from date is not shared" */
      it("returns today's span and not yesterday's", async () => {
        const authorization = aggregateProof({
          projectId: AGGREGATE,
          members: [{ projectId: MEMBER_A, from: TODAY }],
          now: NOW,
        });
        const byTrace = { authorization, traceId: A_TRACE, occurredAtMs: TODAY };

        const spans = await repo.findSpansByTraceId(byTrace);
        expect(spans.map((span) => span.span_id)).toEqual(["a-today"]);

        const summary = await repo.findSpanSummaryByTraceId(byTrace);
        expect(summary.map((row) => row.spanId)).toEqual(["a-today"]);
      });
    });
  });

  describe("given a plain project with no shared grants", () => {
    describe("when it reads its trace through an own-only proof", () => {
      /** @scenario "A plain project reads the same rows as before" */
      it("returns the same span ids in the same order as a direct tenant query", async () => {
        const authorization = ownProof({ projectId: PLAIN, now: NOW });

        // No hint: the read resolves the trace's time through `trace_summaries`
        // first, so that statement carries the fence too.
        const viaProof = await repo.findSpansByTraceId({ authorization, traceId: PLAIN_TRACE });

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
        const directIds = (await direct.json<{ SpanId: string }>()).map((row) => row.SpanId);

        expect(directIds).toHaveLength(PLAIN_SPANS);
        expect(viaProof.map((span) => span.span_id)).toEqual(directIds);
      });
    });
  });
});
