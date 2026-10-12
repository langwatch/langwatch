/**
 * Trace's id indexes against the production schema (goose 00110): the views fill them inside
 * each insert, and with trace's flag on a lookup by trace id with no time is bounded to the
 * index's range. Spec: specs/clickhouse/id-index-reads.feature
 */
import type { ClickHouseClient } from "@clickhouse/client";
import {
  AuthorizedClickHouse,
  ClickHouseQueryClient,
  ID_INDEX_WIDEN_MS,
  type IdIndexFlags,
  type QueryDriver,
  setWindowedReadMetrics,
  TenantGuard,
  type WindowedReadOutcome,
} from "@langwatch/clickhouse-client";
import { partsAfterPartitionPruning } from "@langwatch/clickhouse-client/testing";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { ownProof } from "../../../__tests__/support/authorization-proofs.fixture.ts";
import { SpanStorageClickHouseRepository } from "../span-storage.repository.ts";
import { TraceSummaryClickHouseRepository } from "../trace-summary.repository.ts";
import {
  startMigratedTraceClickHouse,
  testClickHouseConfigured,
} from "./support/clickhouse-endpoint.support.ts";

const clickHouseConfigured = testClickHouseConfigured();
const DAY_MS = 24 * 60 * 60 * 1000;
const FLAG_ON: IdIndexFlags = { isOn: () => true };

const tenantId = `test-trace-id-index-${nanoid()}`;
const eightWeeksAgo = Date.now() - 56 * DAY_MS;

let ch: ClickHouseClient;
let spans: SpanStorageClickHouseRepository;
let summaries: TraceSummaryClickHouseRepository;
type Statement = { sql: string; params: Record<string, unknown> };
let statements: Statement[];
let outcomes: { table: string; outcome: WindowedReadOutcome }[];

/** The test ClickHouse behind the fence, recording every statement the reads send. */
function recordingAuthorizedClickHouse(client: ClickHouseClient): AuthorizedClickHouse {
  const driver: QueryDriver = {
    async execute(request) {
      statements.push({ sql: request.sql, params: request.params ?? {} });
      const result = await client.query({
        query: request.sql,
        format: "JSONEachRow",
        ...(request.params === undefined ? {} : { query_params: request.params }),
      });
      return { rows: await result.json() };
    },
    async insert(request) {
      await client.insert({ table: request.table, values: request.rows, format: "JSONEachRow" });
    },
    async command(request) {
      await client.command({ query: request.sql });
    },
  };
  const queryClient = new ClickHouseQueryClient({ tenantGuard: new TenantGuard(), driver });
  return new AuthorizedClickHouse({ resolveClient: async () => queryClient });
}

/** A span kept forever by default, so no TTL merge can drop an eight-week-old fixture. */
function spanRow({
  traceId,
  startMs,
  retentionDays = 0,
}: {
  traceId: string;
  startMs: number;
  retentionDays?: number;
}) {
  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: tenantId,
    TraceId: traceId,
    SpanId: `span-${nanoid()}`,
    Sampled: 1,
    StartTime: new Date(startMs),
    EndTime: new Date(startMs + 50),
    DurationMs: 50,
    SpanName: "indexed-span",
    SpanKind: 1,
    ServiceName: "test-service",
    ResourceAttributes: {},
    SpanAttributes: {},
    StatusCode: 1,
    ScopeName: "test",
    _retention_days: retentionDays,
    CreatedAt: new Date(startMs),
    UpdatedAt: new Date(startMs),
  };
}

async function insertSpans(rows: ReturnType<typeof spanRow>[]): Promise<void> {
  await ch.insert({
    table: "stored_spans",
    values: rows,
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, date_time_input_format: "best_effort" },
  });
}

async function insertSummary({ traceId, occurredAtMs }: { traceId: string; occurredAtMs: number }) {
  await ch.insert({
    table: "trace_summaries",
    values: [
      {
        ProjectionId: `proj-${nanoid()}`,
        TenantId: tenantId,
        TraceId: traceId,
        OccurredAt: new Date(occurredAtMs),
        CreatedAt: new Date(occurredAtMs),
        UpdatedAt: new Date(occurredAtMs),
        SpanCount: 1,
        _retention_days: 0,
      },
    ],
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, date_time_input_format: "best_effort" },
  });
}

/** One index row for a trace, merged as a reader sees it. */
async function indexRange({ index, traceId }: { index: string; traceId: string }) {
  const result = await ch.query({
    query: `SELECT count() AS n, toUnixTimestamp64Milli(min(FromAt)) AS fromMs,
        toUnixTimestamp64Milli(max(ToAt)) AS toMs, max(_retention_days) AS retention
      FROM ${index} WHERE TenantId = {tenantId:String} AND TraceId = {traceId:String}`,
    query_params: { tenantId, traceId },
    format: "JSONEachRow",
  });
  const [row] = await result.json<Record<string, unknown>>();
  return {
    n: Number(row?.n),
    fromMs: Number(row?.fromMs),
    toMs: Number(row?.toMs),
    retention: Number(row?.retention),
  };
}

/** The bound the last source read of `table` ran with. */
function lastBound({ table }: { table: string }) {
  const read = statements.findLast(
    (statement) => statement.sql.includes(`FROM ${table}`) && "fromMs" in statement.params,
  );
  return { fromMs: Number(read?.params.fromMs), toMs: Number(read?.params.toMs) };
}

/** The last statement that read `table`'s source rows, not its index. */
function lastRead({ table }: { table: string }) {
  const read = statements.findLast(
    (statement) => statement.sql.includes(`FROM ${table}`) && !statement.sql.includes("_id_index"),
  );
  if (!read) throw new Error(`no source read of ${table} was sent`);
  return read;
}

/** One query on the test server, its rows as JSONEachRow parses them. */
async function queryRows(query: string, params?: Record<string, unknown>): Promise<unknown[]> {
  const result = await ch.query({
    query,
    format: "JSONEachRow",
    ...(params === undefined ? {} : { query_params: params }),
  });
  return result.json();
}

/** Parts a bounded read reaches against the same read with no index, as the planner prunes. */
async function prunedParts({ bounded, unbounded }: { bounded: Statement; unbounded: Statement }) {
  return {
    bounded: await partsAfterPartitionPruning({ query: queryRows, request: bounded }),
    unbounded: await partsAfterPartitionPruning({ query: queryRows, request: unbounded }),
  };
}

beforeAll(async () => {
  if (!clickHouseConfigured) return;
  ch = await startMigratedTraceClickHouse();
  // Decoy traces in weeks no fixture uses, so an unbounded read reaches partitions a bound skips.
  for (const daysAgo of [150, 250]) {
    const traceId = `decoy-${nanoid()}`;
    await insertSpans([spanRow({ traceId, startMs: Date.now() - daysAgo * DAY_MS })]);
    await insertSummary({ traceId, occurredAtMs: Date.now() - daysAgo * DAY_MS });
  }
  const clickhouse = recordingAuthorizedClickHouse(ch);
  spans = SpanStorageClickHouseRepository.create({ resolveClient: async () => ch, clickhouse });
  summaries = TraceSummaryClickHouseRepository.create({
    resolveClient: async () => ch,
    clickhouse,
  });
}, 120_000);

beforeEach(() => {
  statements = [];
  outcomes = [];
  setWindowedReadMetrics({ record: (entry) => outcomes.push(entry) });
});

afterAll(async () => {
  if (!ch) return;
  for (const table of ["stored_spans", "trace_summaries"]) {
    await ch.exec({
      query: `ALTER TABLE ${table} DELETE WHERE TenantId = {tenantId:String}`,
      query_params: { tenantId },
    });
  }
});

describe.skipIf(!clickHouseConfigured)("trace id indexes", () => {
  describe("given a trace stored eight weeks ago", () => {
    /** @scenario "a lookup by id reads only the partitions the index names" */
    it("bounds the span read to the index's range widened by a day and counts a hit", async () => {
      const traceId = `trace-${nanoid()}`;
      await insertSpans([spanRow({ traceId, startMs: eightWeeksAgo })]);

      const found = await spans.findSpansByTraceId({
        authorization: ownProof({ projectId: tenantId }),
        traceId,
        idIndex: FLAG_ON,
      });

      expect(found).toHaveLength(1);
      const range = await indexRange({ index: "stored_spans_id_index", traceId });
      expect(lastBound({ table: "stored_spans" })).toEqual({
        fromMs: range.fromMs - ID_INDEX_WIDEN_MS,
        toMs: range.toMs + ID_INDEX_WIDEN_MS,
      });
      expect(outcomes).toContainEqual({ table: "stored_spans", outcome: "index_hit" });
      const bounded = lastRead({ table: "stored_spans" });
      statements = [];
      await spans.findSpansByTraceId({ authorization: ownProof({ projectId: tenantId }), traceId });
      const parts = await prunedParts({ bounded, unbounded: lastRead({ table: "stored_spans" }) });
      expect(parts.bounded).toBeLessThan(parts.unbounded);
    });

    /** @scenario "a trace opens with no time" */
    it("reads its summary and its spans with no time, each bounded by the index", async () => {
      const traceId = `trace-${nanoid()}`;
      await insertSpans([spanRow({ traceId, startMs: eightWeeksAgo })]);
      await insertSummary({ traceId, occurredAtMs: eightWeeksAgo });
      const authorization = ownProof({ projectId: tenantId });

      const summary = await summaries.findByTraceId({ authorization, traceId, idIndex: FLAG_ON });
      const found = await spans.findSpansByTraceId({ authorization, traceId, idIndex: FLAG_ON });

      expect(summary?.traceId).toBe(traceId);
      expect(found).toHaveLength(1);
      expect(outcomes).toEqual(
        expect.arrayContaining([
          { table: "trace_summaries", outcome: "index_hit" },
          { table: "stored_spans", outcome: "index_hit" },
        ]),
      );
      expect(lastBound({ table: "trace_summaries" }).fromMs).toBeGreaterThan(
        eightWeeksAgo - 2 * DAY_MS,
      );
      const bounded = {
        summary: lastRead({ table: "trace_summaries" }),
        spans: lastRead({ table: "stored_spans" }),
      };
      for (const table of ["trace_summaries", "stored_spans"] as const) {
        const parts = await prunedParts({
          bounded: table === "trace_summaries" ? bounded.summary : bounded.spans,
          unbounded: {
            sql: `SELECT TraceId FROM ${table} WHERE TenantId = {tenantId:String} AND TraceId = {traceId:String}`,
            params: { tenantId, traceId },
          },
        });
        expect(parts.bounded).toBeLessThan(parts.unbounded);
      }
    });
  });

  describe("given a trace whose spans arrive over several days", () => {
    /** @scenario "a trace's spans arriving over time widen its index range" */
    it("covers the first span to the late one, and the lookup returns both", async () => {
      const traceId = `trace-${nanoid()}`;
      const monday = eightWeeksAgo;
      const thursday = monday + 3 * DAY_MS;
      await insertSpans([spanRow({ traceId, startMs: monday })]);
      await insertSpans([spanRow({ traceId, startMs: thursday })]);

      const range = await indexRange({ index: "stored_spans_id_index", traceId });
      const found = await spans.findSpansByTraceId({
        authorization: ownProof({ projectId: tenantId }),
        traceId,
        idIndex: FLAG_ON,
      });

      expect(range).toMatchObject({ fromMs: monday, toMs: thursday });
      expect(found).toHaveLength(2);
    });
  });

  describe("given a trace whose spans are stored but whose summary is not projected", () => {
    /** @scenario "a span lookup hits before the trace summary is projected" */
    it("bounds the span read by the span index and returns the spans", async () => {
      const traceId = `trace-${nanoid()}`;
      await insertSpans([spanRow({ traceId, startMs: eightWeeksAgo })]);

      const found = await spans.findSpansByTraceId({
        authorization: ownProof({ projectId: tenantId }),
        traceId,
        idIndex: FLAG_ON,
      });

      expect((await indexRange({ index: "trace_summaries_id_index", traceId })).n).toBe(0);
      expect(found).toHaveLength(1);
      expect(outcomes).toContainEqual({ table: "stored_spans", outcome: "index_hit" });
    });
  });

  describe("given a trace whose projection is replayed", () => {
    /** @scenario "a projection replay re-inserting rows leaves the index range correct" */
    it("keeps the index range when the same rows are inserted again", async () => {
      const traceId = `trace-${nanoid()}`;
      const rows = [
        spanRow({ traceId, startMs: eightWeeksAgo }),
        spanRow({ traceId, startMs: eightWeeksAgo + 3 * DAY_MS }),
      ];
      await insertSpans(rows);
      const before = await indexRange({ index: "stored_spans_id_index", traceId });

      await insertSpans(rows);

      expect(await indexRange({ index: "stored_spans_id_index", traceId })).toMatchObject({
        fromMs: before.fromMs,
        toMs: before.toMs,
      });
    });
  });

  describe("given a trace whose short retention has passed, beside one kept forever", () => {
    /** @scenario "the index expires with the data it points at" */
    it("never keeps the expired trace's index row, before or after a merge, and keeps the forever one", async () => {
      const expired = `trace-${nanoid()}`;
      const forever = `trace-${nanoid()}`;
      // One day's retention plus the index's seven days of slack is long past at thirty days.
      const thirtyDaysAgo = Date.now() - 30 * DAY_MS;
      await insertSpans([
        spanRow({ traceId: expired, startMs: thirtyDaysAgo, retentionDays: 1 }),
        spanRow({ traceId: forever, startMs: thirtyDaysAgo, retentionDays: 0 }),
      ]);
      // ClickHouse applies the TTL as it writes the part, so an expired row never lands at all.
      expect((await indexRange({ index: "stored_spans_id_index", traceId: expired })).n).toBe(0);

      await ch.command({ query: "OPTIMIZE TABLE stored_spans_id_index FINAL" });

      expect((await indexRange({ index: "stored_spans_id_index", traceId: expired })).n).toBe(0);
      expect(await indexRange({ index: "stored_spans_id_index", traceId: forever })).toMatchObject({
        n: 1,
        retention: 65_535,
      });
    });
  });
});
