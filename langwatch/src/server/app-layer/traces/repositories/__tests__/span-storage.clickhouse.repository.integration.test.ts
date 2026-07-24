/**
 * Integration tests for the single-trace span readers on
 * `SpanStorageClickHouseRepository`, exercised against a real ClickHouse
 * testcontainer on the production `stored_spans` schema.
 *
 * These readers carry an explicit `max_memory_usage` cap so a trace with very
 * large per-span attribute values fails its own read instead of pressuring the
 * whole server (see `SINGLE_TRACE_READ_MAX_MEMORY_BYTES`). The cap itself can't
 * be asserted by tripping an OOM here — an errored ClickHouse response stream
 * wedges the vitest worker — so the unit test asserts the setting is passed,
 * and this suite confirms a normal trace read still returns correct results
 * under the cap (ordering, latest-version dedup, full payload preserved).
 */

import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  startTestContainers,
  stopTestContainers,
} from "../../../../event-sourcing/__tests__/integration/testContainers";
import type { SpanInsertData } from "../../types";
import { SpanStorageClickHouseRepository } from "../span-storage.clickhouse.repository";

const tenantId = `test-span-fetch-${nanoid()}`;
const traceId = `trace-${nanoid()}`;
const base = Date.now() - 60 * 60 * 1000;

const TOTAL_SPANS = 600;
const READ_LIMIT = 512;
const ATTR_KEYS = 20;
const ATTR_VALUE = "v".repeat(1000);

let ch: ClickHouseClient;
let repo: SpanStorageClickHouseRepository;

function spanIdFor(i: number): string {
  return `span-${String(i).padStart(4, "0")}`;
}

function heavyAttributes(i: number): Record<string, string> {
  const attrs: Record<string, string> = { idx: String(i) };
  for (let k = 0; k < ATTR_KEYS; k++) {
    attrs[`k${k}`] = ATTR_VALUE;
  }
  return attrs;
}

function makeSpanRow(i: number, overrides: Record<string, unknown> = {}) {
  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: tenantId,
    TraceId: traceId,
    SpanId: spanIdFor(i),
    ParentSpanId: null,
    ParentTraceId: null,
    ParentIsRemote: null,
    Sampled: 1,
    StartTime: new Date(base + i),
    EndTime: new Date(base + i + 50),
    DurationMs: 50,
    SpanName: "test-span",
    SpanKind: 1,
    ServiceName: "test-service",
    ResourceAttributes: {},
    SpanAttributes: heavyAttributes(i),
    StatusCode: 1,
    StatusMessage: null,
    ScopeName: "test",
    ScopeVersion: null,
    "Events.Timestamp": [] as Date[],
    "Events.Name": [] as string[],
    "Events.Attributes": [] as Record<string, string>[],
    "Links.TraceId": [] as string[],
    "Links.SpanId": [] as string[],
    "Links.Attributes": [] as Record<string, string>[],
    DroppedAttributesCount: 0,
    DroppedEventsCount: 0,
    DroppedLinksCount: 0,
    CreatedAt: new Date(base + i),
    UpdatedAt: new Date(base + i),
    ...overrides,
  };
}

async function insertRows(rows: ReturnType<typeof makeSpanRow>[]) {
  const chunk = 200;
  for (let i = 0; i < rows.length; i += chunk) {
    await ch.insert({
      table: "stored_spans",
      values: rows.slice(i, i + chunk),
      format: "JSONEachRow",
      clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
    });
  }
}

beforeAll(async () => {
  const containers = await startTestContainers();
  ch = containers.clickHouseClient;
  repo = new SpanStorageClickHouseRepository(async () => ch);

  const rows = Array.from({ length: TOTAL_SPANS }, (_, i) => makeSpanRow(i));
  await insertRows(rows);

  // A stale earlier version of the first span: the dedup must return the
  // latest version (no `stale` marker), never this one.
  //
  // Override StartTime as well as UpdatedAt: stored_spans is
  // ReplacingMergeTree(StartTime), so a tied StartTime lets the engine
  // collapse the two versions at merge time keeping whichever was inserted
  // last among the tie (the stale row here, inserted after the live span 0)
  // — leaving the read with only the stale row to dedup. A strictly older
  // StartTime makes the stale row deterministically lose the merge
  // regardless of merge timing or shard load. (Same fix the events fixture
  // below already applies for `evt-span-1`.)
  await insertRows([
    makeSpanRow(0, {
      SpanAttributes: { idx: "0", stale: "yes" },
      StartTime: new Date(base - 10_000),
      EndTime: new Date(base - 10_000 + 50),
      UpdatedAt: new Date(base - 10_000),
      CreatedAt: new Date(base - 10_000),
    }),
  ]);
}, 120_000);

afterAll(async () => {
  if (ch) {
    await ch.exec({
      query:
        "ALTER TABLE stored_spans DELETE WHERE TenantId = {tenantId:String}",
      query_params: { tenantId },
    });
  }
  await stopTestContainers();
});

// Event-bearing fixtures for the events-only readers below. Isolated under a
// distinct tenant/trace so the heavy single-trace dataset above is untouched.
const eventsTenantId = `test-span-events-${nanoid()}`;
const eventsTraceId = `trace-${nanoid()}`;

function makeEventRow(
  spanId: string,
  events: { ts: Date; name: string; attrs: Record<string, string> }[],
  overrides: Record<string, unknown> = {},
): ReturnType<typeof makeSpanRow> {
  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: eventsTenantId,
    TraceId: eventsTraceId,
    SpanId: spanId,
    ParentSpanId: null,
    ParentTraceId: null,
    ParentIsRemote: null,
    Sampled: 1,
    StartTime: new Date(base),
    EndTime: new Date(base + 50),
    DurationMs: 50,
    SpanName: "events-span",
    SpanKind: 1,
    ServiceName: "test-service",
    ResourceAttributes: {},
    SpanAttributes: {},
    StatusCode: 1,
    StatusMessage: null,
    ScopeName: "test",
    ScopeVersion: null,
    "Events.Timestamp": events.map((e) => e.ts),
    "Events.Name": events.map((e) => e.name),
    "Events.Attributes": events.map((e) => e.attrs),
    "Links.TraceId": [],
    "Links.SpanId": [],
    "Links.Attributes": [],
    DroppedAttributesCount: 0,
    DroppedEventsCount: 0,
    DroppedLinksCount: 0,
    CreatedAt: new Date(base),
    UpdatedAt: new Date(base),
    ...overrides,
  };
}

describe("SpanStorageClickHouseRepository single-trace reads (integration)", () => {
  describe("when reading a trace under the per-query memory cap", () => {
    it("returns the earliest `limit` spans ordered by StartTime", async () => {
      const spans = await repo.getNormalizedSpansByTraceId({
        tenantId,
        traceId,
      });

      expect(spans).toHaveLength(READ_LIMIT);
      expect(spans.map((s) => s.spanId)).toEqual(
        Array.from({ length: READ_LIMIT }, (_, i) => spanIdFor(i)),
      );

      const startTimes = spans.map((s) => s.startTimeUnixMs);
      const sorted = [...startTimes].sort((a, b) => a - b);
      expect(startTimes).toEqual(sorted);
    });

    it("returns the latest version of a duplicated span, not the stale one", async () => {
      const spans = await repo.getNormalizedSpansByTraceId({
        tenantId,
        traceId,
      });

      const first = spans.find((s) => s.spanId === spanIdFor(0));
      expect(first).toBeDefined();
      // The stale version carried a `stale` marker; the latest one never did.
      expect(first?.spanAttributes.stale).toBeUndefined();
      expect(String(first?.spanAttributes.idx)).toBe("0");
    });

    it("preserves the full heavy SpanAttributes payload", async () => {
      const spans = await repo.getNormalizedSpansByTraceId({
        tenantId,
        traceId,
      });

      const sample = spans[10]!;
      expect(Object.keys(sample.spanAttributes)).toContain("k0");
      expect(sample.spanAttributes.k0).toBe(ATTR_VALUE);
    });
  });

  // Regression: both readers below previously placed `ARRAY JOIN` after `WHERE`
  // (`getEventsByTraceId` additionally carried a second `WHERE` clause), which
  // ClickHouse rejects with Code 62 SYNTAX_ERROR. The old string-pattern unit
  // test couldn't observe the parse failure — these execute the queries.
  describe("when reading a trace with OTel events", () => {
    const baseTs = new Date(base + 200);
    const t = (offsetMs: number) => new Date(baseTs.getTime() + offsetMs);

    beforeAll(async () => {
      await insertRows([
        makeEventRow("evt-span-1", [
          { ts: t(0), name: "span.start", attrs: { phase: "init" } },
          { ts: t(10), name: "exception", attrs: { type: "TimeoutError" } },
          { ts: t(20), name: "span.end", attrs: { phase: "done" } },
        ]),
        makeEventRow("evt-span-2", [
          { ts: t(5), name: "process.tick", attrs: { iter: "1" } },
        ]),
        // Stale earlier version of evt-span-1 — dedup must drop it. Override
        // StartTime as well as UpdatedAt: stored_spans is
        // ReplacingMergeTree(StartTime), so a tied StartTime lets the engine
        // collapse the live row at insert time (rows in one INSERT land in a
        // single part, and the engine resolves ties unpredictably). A strictly
        // older StartTime makes the stale row deterministically lose the merge.
        makeEventRow(
          "evt-span-1",
          [{ ts: t(-1000), name: "stale.skip", attrs: { v: "old" } }],
          {
            StartTime: new Date(base - 60_000),
            EndTime: new Date(base - 60_000 + 50),
            UpdatedAt: new Date(base - 60_000),
            CreatedAt: new Date(base - 60_000),
          },
        ),
      ]);
    });

    afterAll(async () => {
      await ch.exec({
        query:
          "ALTER TABLE stored_spans DELETE WHERE TenantId = {tenantId:String}",
        query_params: { tenantId: eventsTenantId },
      });
    });

    it("getTraceEventsByTraceId returns all events incl. exceptions in event_timestamp ASC order, latest span version only", async () => {
      const events = await repo.getTraceEventsByTraceId({
        tenantId: eventsTenantId,
        traceId: eventsTraceId,
      });

      expect(events.map((e) => e.name)).toEqual([
        "span.start",
        "process.tick",
        "exception",
        "span.end",
      ]);
      // Stale row was older than the live one — it must not appear.
      expect(events.find((e) => e.name === "stale.skip")).toBeUndefined();
    });

    it("getEventsByTraceId filters out exception events and orders by event_timestamp DESC, latest span version only", async () => {
      const events = await repo.getEventsByTraceId({
        tenantId: eventsTenantId,
        traceId: eventsTraceId,
      });

      expect(events.map((e) => e.event_type)).toEqual([
        "span.end",
        "process.tick",
        "span.start",
      ]);
      expect(events.find((e) => e.event_type === "exception")).toBeUndefined();
      expect(events.find((e) => e.event_type === "stale.skip")).toBeUndefined();
    });
  });

  // The drawer fires the events read off entry points that drop the
  // `occurredAtMs` URL hint (back-stack, conversation jumps, deep links), and
  // worker callers never carry one. Without a hint the read used to walk every
  // weekly `stored_spans` partition (incl. cold S3). The reader now seeds the
  // partition window from the trace's own `trace_summaries.OccurredAt`, and an
  // empty result is authoritative (no unbounded rescan).
  describe("given the events are read without an occurredAtMs hint", () => {
    const hintlessTenantId = `test-span-hintless-${nanoid()}`;
    const withEventsTraceId = `trace-${nanoid()}`;
    const noEventsTraceId = `trace-${nanoid()}`;
    const summaryOccurredAt = new Date(base);

    async function insertTraceSummary(tid: string) {
      await ch.insert({
        table: "trace_summaries",
        values: [
          {
            ProjectionId: `proj-${nanoid()}`,
            TenantId: hintlessTenantId,
            TraceId: tid,
            Version: "v1",
            OccurredAt: summaryOccurredAt,
            CreatedAt: summaryOccurredAt,
            UpdatedAt: summaryOccurredAt,
          },
        ],
        format: "JSONEachRow",
        clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
      });
    }

    beforeAll(async () => {
      await ch.insert({
        table: "stored_spans",
        values: [
          {
            ...makeEventRow("hintless-span-1", [
              { ts: new Date(base + 5), name: "span.start", attrs: { p: "1" } },
            ]),
            TenantId: hintlessTenantId,
            TraceId: withEventsTraceId,
          },
        ],
        format: "JSONEachRow",
        clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
      });
      await insertTraceSummary(withEventsTraceId);
      await insertTraceSummary(noEventsTraceId);
    });

    afterAll(async () => {
      await ch.exec({
        query:
          "ALTER TABLE stored_spans DELETE WHERE TenantId = {tenantId:String}",
        query_params: { tenantId: hintlessTenantId },
      });
      await ch.exec({
        query:
          "ALTER TABLE trace_summaries DELETE WHERE TenantId = {tenantId:String}",
        query_params: { tenantId: hintlessTenantId },
      });
    });

    describe("when the trace's occurrence time is recorded in trace_summaries", () => {
      it("resolves the partition window from trace_summaries and still returns the events", async () => {
        const events = await repo.getTraceEventsByTraceId({
          tenantId: hintlessTenantId,
          traceId: withEventsTraceId,
        });

        expect(events.map((e) => e.name)).toEqual(["span.start"]);
      });

      it("returns no events for a trace without any, without an unbounded rescan", async () => {
        // Wrap the client so we can see every stored_spans query the read
        // issues. With the window resolved from trace_summaries, an empty
        // result is final: exactly one stored_spans read, all of them
        // partition-bounded (carry the StartTime predicate / fromMs param).
        const storedSpansQueries: { query: string; params: unknown }[] = [];
        const recordingClient = new Proxy(ch, {
          get(target, prop, receiver) {
            if (prop === "query") {
              return (args: { query: string; query_params?: unknown }) => {
                if (args.query.includes("stored_spans")) {
                  storedSpansQueries.push({
                    query: args.query,
                    params: args.query_params,
                  });
                }
                return (target as ClickHouseClient).query(args as never);
              };
            }
            return Reflect.get(target, prop, receiver);
          },
        }) as ClickHouseClient;
        const recordingRepo = new SpanStorageClickHouseRepository(
          async () => recordingClient,
        );

        const events = await recordingRepo.getTraceEventsByTraceId({
          tenantId: hintlessTenantId,
          traceId: noEventsTraceId,
        });

        expect(events).toEqual([]);
        expect(storedSpansQueries).toHaveLength(1);
        expect(storedSpansQueries[0]!.query).toContain("StartTime >=");
      });
    });
  });

  // The single-trace span readers fire from the same hint-dropping entry points
  // as the events read (back-stack / conversation jumps / deep links) and from
  // worker callers that never had an `occurredAtMs`. Without a hint they used to
  // walk every weekly `stored_spans` partition (incl. cold S3). They now seed
  // the partition window from the trace's own `trace_summaries.OccurredAt` and
  // read that window first. Unlike the events read, an empty windowed result is
  // NOT authoritative for spans (OccurredAt is the trace start and never widens,
  // so a long-running trace can produce spans past OccurredAt + 2 days): the
  // reader falls back to an unbounded rescan, and only skips the window entirely
  // when the trace isn't in `trace_summaries` at all.
  describe("given a span read without an occurredAtMs hint", () => {
    const hintlessTenantId = `test-span-read-hintless-${nanoid()}`;
    const withSpansTraceId = `trace-${nanoid()}`;
    const emptyTraceId = `trace-${nanoid()}`;
    const orphanTraceId = `trace-${nanoid()}`;
    const outOfWindowTraceId = `trace-${nanoid()}`;
    const summaryOccurredAt = new Date(base);
    // Five days past the summary's OccurredAt — outside the ±2-day resolved
    // window, so a long-running trace whose late spans land here must still be
    // returned via the unbounded fallback rather than silently dropped.
    const outOfWindowStartTime = new Date(base + 5 * 24 * 60 * 60 * 1000);

    async function insertSummary(tid: string) {
      await ch.insert({
        table: "trace_summaries",
        values: [
          {
            ProjectionId: `proj-${nanoid()}`,
            TenantId: hintlessTenantId,
            TraceId: tid,
            Version: "v1",
            OccurredAt: summaryOccurredAt,
            CreatedAt: summaryOccurredAt,
            UpdatedAt: summaryOccurredAt,
          },
        ],
        format: "JSONEachRow",
        clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
      });
    }

    beforeAll(async () => {
      await insertRows([
        makeSpanRow(0, {
          TenantId: hintlessTenantId,
          TraceId: withSpansTraceId,
          SpanAttributes: { idx: "0" },
        }),
        makeSpanRow(0, {
          TenantId: hintlessTenantId,
          TraceId: outOfWindowTraceId,
          StartTime: outOfWindowStartTime,
          SpanAttributes: { idx: "0" },
        }),
      ]);
      // `withSpansTraceId`, `emptyTraceId` and `outOfWindowTraceId` are in
      // trace_summaries (time resolvable); `orphanTraceId` deliberately is not.
      await insertSummary(withSpansTraceId);
      await insertSummary(emptyTraceId);
      await insertSummary(outOfWindowTraceId);
    });

    afterAll(async () => {
      await ch.exec({
        query:
          "ALTER TABLE stored_spans DELETE WHERE TenantId = {tenantId:String}",
        query_params: { tenantId: hintlessTenantId },
      });
      await ch.exec({
        query:
          "ALTER TABLE trace_summaries DELETE WHERE TenantId = {tenantId:String}",
        query_params: { tenantId: hintlessTenantId },
      });
    });

    it("resolves the partition window from trace_summaries and still returns the spans", async () => {
      const spans = await repo.getNormalizedSpansByTraceId({
        tenantId: hintlessTenantId,
        traceId: withSpansTraceId,
      });

      expect(spans.map((s) => s.spanId)).toEqual([spanIdFor(0)]);
    });

it("returns no spans for a trace without any, via the bounded-then-unbounded fallback", async () => {
      const storedSpansQueries: { query: string; params: unknown }[] = [];
      const recordingClient = new Proxy(ch, {
        get(target, prop, receiver) {
          if (prop === "query") {
            return (args: { query: string; query_params?: unknown }) => {
              if (args.query.includes("stored_spans")) {
                storedSpansQueries.push({
                  query: args.query,
                  params: args.query_params,
                });
              }
              return (target as ClickHouseClient).query(args as never);
            };
          }
          return Reflect.get(target, prop, receiver);
        },
      }) as ClickHouseClient;
      const recordingRepo = new SpanStorageClickHouseRepository(
        async () => recordingClient,
      );

      const spans = await recordingRepo.getNormalizedSpansByTraceId({
        tenantId: hintlessTenantId,
        traceId: emptyTraceId,
      });

      // A trace's OccurredAt is its start and never widens, so an empty windowed
      // result is not authoritative for spans: fall back to an unbounded rescan
      // (bounded read first, then the unbounded one) rather than risk dropping
      // spans on a long-running trace.
      expect(spans).toEqual([]);
      expect(storedSpansQueries).toHaveLength(2);
      expect(storedSpansQueries[0]!.query).toContain("StartTime >=");
      expect(storedSpansQueries[1]!.query).not.toContain("StartTime >=");
    });

    it("returns spans that fall outside the resolved ±2-day window via the unbounded fallback", async () => {
      const storedSpansQueries: { query: string; params: unknown }[] = [];
      const recordingClient = new Proxy(ch, {
        get(target, prop, receiver) {
          if (prop === "query") {
            return (args: { query: string; query_params?: unknown }) => {
              if (args.query.includes("stored_spans")) {
                storedSpansQueries.push({
                  query: args.query,
                  params: args.query_params,
                });
              }
              return (target as ClickHouseClient).query(args as never);
            };
          }
          return Reflect.get(target, prop, receiver);
        },
      }) as ClickHouseClient;
      const recordingRepo = new SpanStorageClickHouseRepository(
        async () => recordingClient,
      );

      const spans = await recordingRepo.getNormalizedSpansByTraceId({
        tenantId: hintlessTenantId,
        traceId: outOfWindowTraceId,
      });

      // The span sits 5 days past OccurredAt, outside the ±2-day window, so the
      // bounded read misses it and the unbounded fallback recovers it — the
      // long-running-trace correctness case the resolved window alone breaks.
      expect(spans.map((s) => s.spanId)).toEqual([spanIdFor(0)]);
      expect(storedSpansQueries).toHaveLength(2);
      expect(storedSpansQueries[0]!.query).toContain("StartTime >=");
      expect(storedSpansQueries[1]!.query).not.toContain("StartTime >=");
    });

    it("stays unbounded for a trace that is not in trace_summaries", async () => {
      // No resolvable time: the reader keeps its previous behaviour and scans
      // unbounded rather than guessing a window.
      const storedSpansQueries: string[] = [];
      const recordingClient = new Proxy(ch, {
        get(target, prop, receiver) {
          if (prop === "query") {
            return (args: { query: string; query_params?: unknown }) => {
              if (args.query.includes("stored_spans")) {
                storedSpansQueries.push(args.query);
              }
              return (target as ClickHouseClient).query(args as never);
            };
          }
          return Reflect.get(target, prop, receiver);
        },
      }) as ClickHouseClient;
      const recordingRepo = new SpanStorageClickHouseRepository(
        async () => recordingClient,
      );

      const spans = await recordingRepo.getNormalizedSpansByTraceId({
        tenantId: hintlessTenantId,
        traceId: orphanTraceId,
      });

      expect(spans).toEqual([]);
      expect(storedSpansQueries).toHaveLength(1);
      expect(storedSpansQueries[0]!).not.toContain("StartTime >=");
    });
  });
});

// Per-span cost columns (Cost / NonBilledCost) written through the repository's
// own insert path (toClickHouseRecord) and read back (mapChRowToNormalized), so
// both the write mapping and the read mapping of the new columns are exercised
// against the production schema rather than raw-inserted rows.
const costTenantId = `test-span-cost-${nanoid()}`;
const costTraceId = `trace-${nanoid()}`;

function makeSpanInsert(
  spanId: string,
  cost: number | null,
  nonBilledCost: number | null,
): SpanInsertData {
  return {
    id: `proj-${nanoid()}`,
    tenantId: costTenantId,
    traceId: costTraceId,
    spanId,
    parentSpanId: null,
    parentTraceId: null,
    parentIsRemote: null,
    sampled: true,
    startTimeUnixMs: base,
    endTimeUnixMs: base + 50,
    durationMs: 50,
    name: "cost-span",
    kind: 1,
    resourceAttributes: {},
    spanAttributes: {},
    statusCode: 1,
    statusMessage: null,
    instrumentationScope: { name: "test", version: undefined },
    events: [],
    links: [],
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
    cost,
    nonBilledCost,
    retentionDays: 0,
  };
}

describe("SpanStorageClickHouseRepository per-span cost columns (integration)", () => {
  let costRepo: SpanStorageClickHouseRepository;

  beforeAll(async () => {
    const containers = await startTestContainers();
    costRepo = new SpanStorageClickHouseRepository(
      async () => containers.clickHouseClient,
    );

    await costRepo.insertSpans([
      makeSpanInsert("span-billed", 0.0123, null),
      makeSpanInsert("span-bundled", 0.0456, 0.0456),
      makeSpanInsert("span-nocost", null, null),
    ]);
  }, 120_000);

  afterAll(async () => {
    if (ch) {
      await ch.exec({
        query:
          "ALTER TABLE stored_spans DELETE WHERE TenantId = {tenantId:String}",
        query_params: { tenantId: costTenantId },
      });
    }
  });

  describe("when a billed span is stored", () => {
    it("round-trips its Cost with no non-billed portion", async () => {
      const spans = await costRepo.getNormalizedSpansByTraceId({
        tenantId: costTenantId,
        traceId: costTraceId,
        occurredAtMs: base,
      });

      const billed = spans.find((s) => s.spanId === "span-billed");
      expect(billed).toBeDefined();
      expect(billed?.cost).toBeCloseTo(0.0123, 6);
      expect(billed?.nonBilledCost).toBeNull();
    });
  });

  describe("when a non-billable span is stored", () => {
    it("round-trips Cost and NonBilledCost as the full bundled amount", async () => {
      const spans = await costRepo.getNormalizedSpansByTraceId({
        tenantId: costTenantId,
        traceId: costTraceId,
        occurredAtMs: base,
      });

      const bundled = spans.find((s) => s.spanId === "span-bundled");
      expect(bundled).toBeDefined();
      expect(bundled?.cost).toBeCloseTo(0.0456, 6);
      expect(bundled?.nonBilledCost).toBeCloseTo(0.0456, 6);
    });
  });

  describe("when a span without costable usage is stored", () => {
    it("round-trips null Cost and NonBilledCost", async () => {
      const spans = await costRepo.getNormalizedSpansByTraceId({
        tenantId: costTenantId,
        traceId: costTraceId,
        occurredAtMs: base,
      });

      const noCost = spans.find((s) => s.spanId === "span-nocost");
      expect(noCost).toBeDefined();
      expect(noCost?.cost).toBeNull();
      expect(noCost?.nonBilledCost).toBeNull();
    });
  });
});

// Cursor-paged span-summary walk. Own tenant/trace fixtures so page shapes
// are deterministic and the heavy single-trace dataset above is untouched.
const pageTenantId = `test-span-page-${nanoid()}`;

function makePageSpanRow(
  pageTraceId: string,
  spanId: string,
  startTime: Date,
  overrides: Record<string, unknown> = {},
): ReturnType<typeof makeSpanRow> {
  return {
    ...makeSpanRow(0, {
      TenantId: pageTenantId,
      TraceId: pageTraceId,
      SpanId: spanId,
      StartTime: startTime,
      EndTime: new Date(startTime.getTime() + 50),
      CreatedAt: startTime,
      UpdatedAt: startTime,
      SpanAttributes: { idx: spanId },
      ...overrides,
    }),
  };
}

async function walkSpanSummaries(pageTraceId: string, limit: number) {
  const pages: Awaited<
    ReturnType<SpanStorageClickHouseRepository["findSpanSummariesPage"]>
  >[] = [];
  let cursor: { startTimeMs: number; spanId: string } | undefined;
  for (;;) {
    const page = await repo.findSpanSummariesPage({
      tenantId: pageTenantId,
      traceId: pageTraceId,
      limit,
      cursor,
      occurredAtMs: base,
    });
    pages.push(page);
    if (!page.hasMore) break;
    const last = page.rows.at(-1);
    if (!last) throw new Error("hasMore page returned no rows");
    cursor = { startTimeMs: last.startTimeMs, spanId: last.spanId };
  }
  return pages;
}

describe("SpanStorageClickHouseRepository cursor-paged span summaries (integration)", () => {
  const exactTraceId = `trace-${nanoid()}`;
  const tieTraceId = `trace-${nanoid()}`;
  const longTraceId = `trace-${nanoid()}`;
  const EXACT_SPANS = 40;
  const PAGE = 10;

  beforeAll(async () => {
    // Exact-multiple-of-page-size trace (40 spans / pages of 10), including a
    // stale earlier version of one mid-trace span that dedup must not emit.
    await insertRows(
      Array.from({ length: EXACT_SPANS }, (_, i) =>
        makePageSpanRow(exactTraceId, spanIdFor(i), new Date(base + i * 10)),
      ),
    );
    await insertRows([
      makePageSpanRow(exactTraceId, spanIdFor(25), new Date(base - 5_000), {
        SpanAttributes: { idx: spanIdFor(25), stale: "yes" },
      }),
    ]);

    // Four spans sharing one StartTime, so a page boundary falls between
    // same-millisecond rows and only the SpanId tiebreak separates pages.
    await insertRows(
      ["tie-a", "tie-b", "tie-c", "tie-d"].map((spanId) =>
        makePageSpanRow(tieTraceId, spanId, new Date(base + 500)),
      ),
    );

    // Long-running trace: three spans near the occurredAt hint and two more
    // three days later — past the hint's +2-day partition window.
    await insertRows([
      ...[0, 1, 2].map((i) =>
        makePageSpanRow(longTraceId, `early-${i}`, new Date(base + i)),
      ),
      ...[0, 1].map((i) =>
        makePageSpanRow(
          longTraceId,
          `late-${i}`,
          new Date(base + 3 * 24 * 60 * 60 * 1000 + i),
        ),
      ),
    ]);
  }, 60_000);

  describe("when walking a trace whose span count is an exact multiple of the page size", () => {
    it("returns every span exactly once, in (startTimeMs, spanId) order, latest version only", async () => {
      const pages = await walkSpanSummaries(exactTraceId, PAGE);

      const all = pages.flatMap((p) => p.rows);
      expect(all.map((r) => r.spanId)).toEqual(
        Array.from({ length: EXACT_SPANS }, (_, i) => spanIdFor(i)),
      );
      // The stale version of span 25 must not surface as a duplicate or
      // displace the live row's position.
      expect(all.filter((r) => r.spanId === spanIdFor(25))).toHaveLength(1);
    });

    it("reports the final full page as terminal instead of requiring an empty follow-up fetch", async () => {
      const pages = await walkSpanSummaries(exactTraceId, PAGE);

      expect(pages).toHaveLength(EXACT_SPANS / PAGE);
      expect(pages.map((p) => p.hasMore)).toEqual([true, true, true, false]);
      expect(pages.every((p) => p.rows.length === PAGE)).toBe(true);
    });
  });

  describe("when a page boundary falls between spans sharing a StartTime", () => {
    it("the SpanId tiebreak neither skips nor duplicates the same-millisecond spans", async () => {
      const pages = await walkSpanSummaries(tieTraceId, 2);

      expect(pages.map((p) => p.rows.map((r) => r.spanId))).toEqual([
        ["tie-a", "tie-b"],
        ["tie-c", "tie-d"],
      ]);
    });
  });

  describe("when a long-running trace has spans past the occurredAt hint's window", () => {
    it("the walk still reaches them instead of ending at the window edge", async () => {
      const pages = await walkSpanSummaries(longTraceId, 2);

      const all = pages.flatMap((p) => p.rows.map((r) => r.spanId));
      expect(all).toEqual(["early-0", "early-1", "early-2", "late-0", "late-1"]);
    });
  });
});

describe("SpanStorageClickHouseRepository langwatch signals read (integration)", () => {
  const signalsTraceId = `trace-${nanoid()}`;

  beforeAll(async () => {
    await insertRows([
      makePageSpanRow(signalsTraceId, "sig-prompt", new Date(base), {
        SpanAttributes: { "langwatch.prompt.id": "prompt-1" },
      }),
      makePageSpanRow(signalsTraceId, "sig-none", new Date(base + 1)),
    ]);
  }, 60_000);

  describe("when a trace has spans carrying langwatch signal attributes", () => {
    it("executes the capped, ordered scan and returns the signal buckets per span", async () => {
      const rows = await repo.findLangwatchSignalsByTraceId({
        tenantId: pageTenantId,
        traceId: signalsTraceId,
        occurredAtMs: base,
      });

      expect(rows).toEqual([
        { spanId: "sig-prompt", signals: ["prompt"] },
      ]);
    });
  });
});

// A lone (unpaired) UTF-16 surrogate half — the shape a string takes when it is
// truncated mid-emoji, or an SDK captured binary/garbage text as a string.
// `JSONEachRow` serialises it as a `\uD83D`-style escape with no second part,
// which ClickHouse's JSON parser rejects by default ("missing second part of
// surrogate pair") — failing the whole insert, exhausting retries, and
// dead-lettering the span forever. `SPAN_INSERT_SETTINGS` disables that throw
// (`input_format_json_throw_on_bad_escape_sequence: 0`) so the byte is kept as
// text and the span survives. This suite drives the real production write paths
// (`insertSpan` and `insertSpans`) against real ClickHouse: with the setting
// removed, the insert throws here and the round-trip read finds nothing.
const LONE_HIGH_SURROGATE = "\uD83D";
const LONE_LOW_SURROGATE = "\uDC00";

function spanWithLoneSurrogates({
  tenantId: surrogateTenantId,
  traceId: surrogateTraceId,
  spanId,
}: {
  tenantId: string;
  traceId: string;
  spanId: string;
}): SpanInsertData {
  return {
    id: `proj-${nanoid()}`,
    tenantId: surrogateTenantId,
    traceId: surrogateTraceId,
    spanId,
    parentSpanId: null,
    parentTraceId: null,
    parentIsRemote: null,
    sampled: true,
    startTimeUnixMs: base,
    endTimeUnixMs: base + 100,
    durationMs: 100,
    name: `span name ${LONE_HIGH_SURROGATE}`,
    kind: 0,
    resourceAttributes: {
      [`res.key.${LONE_HIGH_SURROGATE}`]: `res.val.${LONE_LOW_SURROGATE}`,
    },
    spanAttributes: {
      clean: "kept-verbatim",
      [`attr.key.${LONE_HIGH_SURROGATE}`]: `attr.val.${LONE_LOW_SURROGATE}`,
      nested: { text: `deep ${LONE_HIGH_SURROGATE}` },
    },
    statusCode: 2,
    statusMessage: `error: ${LONE_LOW_SURROGATE}`,
    instrumentationScope: {
      name: `scope ${LONE_HIGH_SURROGATE}`,
      version: `v1 ${LONE_LOW_SURROGATE}`,
    },
    events: [
      {
        name: `event ${LONE_HIGH_SURROGATE}`,
        timeUnixMs: base + 50,
        attributes: {
          [`ev.key.${LONE_HIGH_SURROGATE}`]: `ev.val.${LONE_LOW_SURROGATE}`,
        },
      },
    ],
    links: [],
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
    cost: null,
    nonBilledCost: null,
    retentionDays: 0,
  };
}

describe("SpanStorageClickHouseRepository lone-surrogate span insert (integration)", () => {
  const surrogateTenantId = `test-span-surrogate-${nanoid()}`;

  afterAll(async () => {
    if (ch) {
      await ch.exec({
        query:
          "ALTER TABLE stored_spans DELETE WHERE TenantId = {tenantId:String}",
        query_params: { tenantId: surrogateTenantId },
      });
    }
  });

  // Each test inserts its own span under a fresh traceId and reads it back
  // within the same test — so it exercises the full write→read path on its own
  // (no ordering dependency on a sibling test) and covers both repository write
  // methods. Without `SPAN_INSERT_SETTINGS`, the insert throws the surrogate-
  // pair parse error and the read-back finds nothing.
  describe("given a span whose name, status, scope, events and attributes carry lone UTF-16 surrogates", () => {
    describe("when it is inserted through the bulk insertSpans write path", () => {
      it("stores the span whole instead of throwing the surrogate-pair error that dead-letters it", async () => {
        const traceId = `trace-${nanoid()}`;
        await expect(
          repo.insertSpans([
            spanWithLoneSurrogates({
              tenantId: surrogateTenantId,
              traceId,
              spanId: "surrogate-bulk",
            }),
          ]),
        ).resolves.toBeUndefined();

        const spans = await repo.getNormalizedSpansByTraceId({
          tenantId: surrogateTenantId,
          traceId,
        });
        const stored = spans.find((s) => s.spanId === "surrogate-bulk");
        expect(stored).toBeDefined();
        expect(String(stored?.spanAttributes.clean)).toBe("kept-verbatim");
      });
    });

    describe("when it is inserted through the single insertSpan write path", () => {
      it("stores the span whole instead of throwing the surrogate-pair error that dead-letters it", async () => {
        const traceId = `trace-${nanoid()}`;
        await expect(
          repo.insertSpan(
            spanWithLoneSurrogates({
              tenantId: surrogateTenantId,
              traceId,
              spanId: "surrogate-single",
            }),
          ),
        ).resolves.toBeUndefined();

        const spans = await repo.getNormalizedSpansByTraceId({
          tenantId: surrogateTenantId,
          traceId,
        });
        const stored = spans.find((s) => s.spanId === "surrogate-single");
        expect(stored).toBeDefined();
        expect(String(stored?.spanAttributes.clean)).toBe("kept-verbatim");
      });
    });
  });
});
