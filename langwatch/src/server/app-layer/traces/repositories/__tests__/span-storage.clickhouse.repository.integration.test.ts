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
