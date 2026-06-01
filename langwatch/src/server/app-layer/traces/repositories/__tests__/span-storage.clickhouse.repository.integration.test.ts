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
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ClickHouseClient } from "@clickhouse/client";
import {
  startTestContainers,
  stopTestContainers,
} from "../../../../event-sourcing/__tests__/integration/testContainers";
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
  await insertRows([
    makeSpanRow(0, {
      SpanAttributes: { idx: "0", stale: "yes" },
      UpdatedAt: new Date(base - 10_000),
      CreatedAt: new Date(base - 10_000),
    }),
  ]);
}, 120_000);

afterAll(async () => {
  if (ch) {
    await ch.exec({
      query: "ALTER TABLE stored_spans DELETE WHERE TenantId = {tenantId:String}",
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
});
