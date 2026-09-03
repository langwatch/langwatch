/**
 * Integration tests for the single-trace span readers on
 * `SpanStorageClickHouseRepository`, exercised against a real ClickHouse, on
 * the production `stored_spans` schema.
 *
 * These readers carry an explicit `max_memory_usage` cap so a trace with very
 * large per-span attribute values fails its own read instead of pressuring the
 * whole server (see `SINGLE_TRACE_READ_MAX_MEMORY_BYTES`). The cap itself can't
 * be asserted by tripping an OOM here — an errored ClickHouse response stream
 * wedges the vitest worker — so the unit test asserts the setting is passed,
 * and this suite confirms a normal trace read still returns correct results
 * under the cap (ordering, latest-version dedup, full payload preserved).
 *
 * Was
 * `platform/app/src/server/app-layer/traces/repositories/__tests__/span-storage.clickhouse.repository.integration.test.ts`,
 * against its own copy of the repository. The repository now lives in this
 * package as `SpanStorageClickHouseRepository`
 * (`../span-storage.repository`); the fixed testcontainer bootstrap it used
 * (`startTestContainers`) went with the monolith, so this uses the shape
 * every other suite in this package uses instead —
 * `createTestClickHouseClient`/`testClickHouseUrl`, skipped when no test
 * ClickHouse is configured. Ported only the "single-trace reads" describe
 * (basic reads, OTel events, and the per-trace event-badge rollups it
 * carries every `@scenario`-tagged case in this file) — the sibling describes
 * further down the original file (per-span cost columns, cursor-paged span
 * summaries against a `findSpanSummariesPage` method the repository no
 * longer has, langwatch-signals read, lone-surrogate insert) carried no
 * `@scenario` tags and were left for a follow-up port.
 */

import type { ClickHouseClient } from "@clickhouse/client";
import type { SpanInsertData } from "@langwatch/trace-contract";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SpanStorageClickHouseRepository } from "../span-storage.repository";
import { MAX_EVENT_NAMES_PER_TRACE } from "../../span-storage.repository";
import {
  createTestClickHouseClient,
  testClickHouseUrl,
} from "./support/clickhouse-endpoint.support";

const clickHouseUrl = testClickHouseUrl();
const integration = describe.skipIf(clickHouseUrl === null);

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
  if (clickHouseUrl === null) return;
  ch = createTestClickHouseClient(clickHouseUrl);
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
      query: "ALTER TABLE stored_spans DELETE WHERE TenantId = {tenantId:String}",
      query_params: { tenantId },
    });
    await ch.close();
  }
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

integration("SpanStorageClickHouseRepository single-trace reads (integration)", () => {
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
        makeEventRow("evt-span-2", [{ ts: t(5), name: "process.tick", attrs: { iter: "1" } }]),
        // Stale earlier version of evt-span-1 — dedup must drop it. Override
        // StartTime as well as UpdatedAt: stored_spans is
        // ReplacingMergeTree(StartTime), so a tied StartTime lets the engine
        // collapse the live row at insert time (rows in one INSERT land in a
        // single part, and the engine resolves ties unpredictably). A strictly
        // older StartTime makes the stale row deterministically lose the merge.
        makeEventRow("evt-span-1", [{ ts: t(-1000), name: "stale.skip", attrs: { v: "old" } }], {
          StartTime: new Date(base - 60_000),
          EndTime: new Date(base - 60_000 + 50),
          UpdatedAt: new Date(base - 60_000),
          CreatedAt: new Date(base - 60_000),
        }),
      ]);
    });

    afterAll(async () => {
      await ch.exec({
        query: "ALTER TABLE stored_spans DELETE WHERE TenantId = {tenantId:String}",
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

      expect(events.map((e) => e.event_type)).toEqual(["span.end", "process.tick", "span.start"]);
      expect(events.find((e) => e.event_type === "exception")).toBeUndefined();
      expect(events.find((e) => e.event_type === "stale.skip")).toBeUndefined();
    });
  });

  // The trace list's Events column. Unlike the two readers above this is
  // batched over a page of traces and collapses each trace's events by name,
  // so what it must get right is the grouping, the batching and the trim.
  describe("when rolling up events for a page of traces", () => {
    const rollupTenantId = `test-event-rollups-${nanoid()}`;
    const feedbackTraceId = `trace-feedback-${nanoid()}`;
    const chattyTraceId = `trace-chatty-${nanoid()}`;
    const quietTraceId = `trace-quiet-${nanoid()}`;
    const noisyTraceId = `trace-noisy-${nanoid()}`;
    const otherTenantTraceId = `trace-other-${nanoid()}`;
    const rollupBase = new Date(base + 1000);
    const at = (offsetMs: number) => new Date(rollupBase.getTime() + offsetMs);
    // The whole fixture sits inside this, so the read's own padding is not
    // what makes these pass.
    const timeRange = {
      from: rollupBase.getTime() - 60_000,
      to: rollupBase.getTime() + 60_000,
    };

    /**
     * A span of this suite's own tenant. Every row goes to `rollupTenantId`
     * unless `overrides` says otherwise, so a fixture meant to belong to a
     * neighbouring tenant has to say so explicitly.
     */
    function rollupRow({
      traceId,
      spanId,
      events,
      overrides = {},
    }: {
      traceId: string;
      spanId: string;
      events: { ts: Date; name: string }[];
      overrides?: Record<string, unknown>;
    }) {
      return makeEventRow(
        spanId,
        events.map((e) => ({ ts: e.ts, name: e.name, attrs: {} })),
        { TenantId: rollupTenantId, TraceId: traceId, ...overrides },
      );
    }

    beforeAll(async () => {
      await insertRows([
        // One tracked-event trace, the shape a thumbs-up lands as.
        rollupRow({
          traceId: feedbackTraceId,
          spanId: "fb-span",
          events: [{ ts: at(10), name: "thumbs_up_down" }],
        }),
        // An agent turn: the same two names over and over, across spans.
        rollupRow({
          traceId: chattyTraceId,
          spanId: "chatty-span-1",
          events: [
            { ts: at(30), name: "gen_ai.request.attempt" },
            { ts: at(40), name: "tool.output" },
            { ts: at(50), name: "gen_ai.request.attempt" },
          ],
        }),
        rollupRow({
          traceId: chattyTraceId,
          spanId: "chatty-span-2",
          events: [
            { ts: at(60), name: "tool.output" },
            { ts: at(70), name: "exception" },
          ],
        }),
        // Stale version of chatty-span-2 — its events must not be counted.
        rollupRow({
          traceId: chattyTraceId,
          spanId: "chatty-span-2",
          events: [{ ts: at(-500), name: "stale.rollup" }],
          overrides: {
            StartTime: new Date(base - 90_000),
            EndTime: new Date(base - 90_000 + 50),
            UpdatedAt: new Date(base - 90_000),
            CreatedAt: new Date(base - 90_000),
          },
        }),
        // A trace whose spans carry no events at all.
        rollupRow({ traceId: quietTraceId, spanId: "quiet-span", events: [] }),
        // More distinct names than one row can show.
        rollupRow({
          traceId: noisyTraceId,
          spanId: "noisy-span",
          events: Array.from({ length: MAX_EVENT_NAMES_PER_TRACE + 5 }, (_, i) => ({
            ts: at(100 + i),
            name: `event.kind.${String(i).padStart(2, "0")}`,
          })),
        }),
        // Our own half of the shared trace id, so the read has something to
        // return for it and the isolation assertion is not vacuous.
        rollupRow({
          traceId: otherTenantTraceId,
          spanId: "other-span",
          events: [{ ts: at(10), name: "thumbs_up_down" }],
        }),
      ]);
      // The neighbour's half: same trace id, different tenant. A read missing
      // its tenant predicate would fold this in.
      await insertRows([
        makeEventRow("other-tenant-span", [{ ts: at(10), name: "leaked", attrs: {} }], {
          TenantId: `${rollupTenantId}-neighbour`,
          TraceId: otherTenantTraceId,
        }),
      ]);
    });

    afterAll(async () => {
      for (const tenant of [rollupTenantId, `${rollupTenantId}-neighbour`]) {
        await ch.exec({
          query: "ALTER TABLE stored_spans DELETE WHERE TenantId = {tenantId:String}",
          query_params: { tenantId: tenant },
        });
      }
    });

    /** @scenario A trace with events shows a badge per event name */
    it("returns one entry per event name for a trace", async () => {
      const rollups = await repo.getTraceEventRollupsByTraceIds({
        tenantId: rollupTenantId,
        traceIds: [feedbackTraceId],
        timeRange,
      });

      expect(rollups[feedbackTraceId]).toEqual({
        names: [
          {
            name: "thumbs_up_down",
            count: 1,
            firstTimestamp: at(10).getTime(),
          },
        ],
        totalCount: 1,
        distinctCount: 1,
      });
    });

    /** @scenario Repeated events of the same name collapse into one badge with a count */
    /** @scenario Badges are ordered by when the event first occurred */
    it("collapses repeats by name, ordered by first occurrence, latest span version only", async () => {
      const rollups = await repo.getTraceEventRollupsByTraceIds({
        tenantId: rollupTenantId,
        traceIds: [chattyTraceId],
        timeRange,
      });

      expect(rollups[chattyTraceId]).toEqual({
        names: [
          {
            name: "gen_ai.request.attempt",
            count: 2,
            firstTimestamp: at(30).getTime(),
          },
          { name: "tool.output", count: 2, firstTimestamp: at(40).getTime() },
          { name: "exception", count: 1, firstTimestamp: at(70).getTime() },
        ],
        totalCount: 5,
        distinctCount: 3,
      });
    });

    /** @scenario Events are shown for the traces currently on screen */
    it("answers a whole page in one call, keyed by trace id", async () => {
      const rollups = await repo.getTraceEventRollupsByTraceIds({
        tenantId: rollupTenantId,
        traceIds: [feedbackTraceId, chattyTraceId, quietTraceId],
        timeRange,
      });

      expect(Object.keys(rollups).sort()).toEqual([feedbackTraceId, chattyTraceId].sort());
    });

    /** @scenario A trace with no events shows the empty marker */
    it("omits a trace that recorded no events", async () => {
      const rollups = await repo.getTraceEventRollupsByTraceIds({
        tenantId: rollupTenantId,
        traceIds: [quietTraceId],
        timeRange,
      });

      expect(rollups[quietTraceId]).toBeUndefined();
    });

    /** @scenario A trace with a very large number of events stays bounded */
    it("trims to the badge cap while still reporting the true totals", async () => {
      const rollups = await repo.getTraceEventRollupsByTraceIds({
        tenantId: rollupTenantId,
        traceIds: [noisyTraceId],
        timeRange,
      });

      const rollup = rollups[noisyTraceId]!;
      expect(rollup.names).toHaveLength(MAX_EVENT_NAMES_PER_TRACE);
      expect(rollup.distinctCount).toBe(MAX_EVENT_NAMES_PER_TRACE + 5);
      expect(rollup.totalCount).toBe(MAX_EVENT_NAMES_PER_TRACE + 5);
      // The trim keeps the earliest names, so the row shows what happened first.
      expect(rollup.names[0]?.name).toBe("event.kind.00");
    });

    /** @scenario Only the caller's project is read */
    it("leaves out the neighbour's events on a trace id both tenants used", async () => {
      const rollups = await repo.getTraceEventRollupsByTraceIds({
        tenantId: rollupTenantId,
        traceIds: [otherTenantTraceId],
        timeRange,
      });

      // Both tenants recorded against this id, so the read returning nothing
      // would pass a "does not contain" check without proving anything.
      expect(rollups[otherTenantTraceId]).toEqual({
        names: [
          {
            name: "thumbs_up_down",
            count: 1,
            firstTimestamp: at(10).getTime(),
          },
        ],
        totalCount: 1,
        distinctCount: 1,
      });
    });

    /** @scenario The search is confined to the period on screen */
    it("returns nothing when the page's time range excludes the spans", async () => {
      const longAgo = rollupBase.getTime() - 400 * 24 * 60 * 60 * 1000;
      const rollups = await repo.getTraceEventRollupsByTraceIds({
        tenantId: rollupTenantId,
        traceIds: [feedbackTraceId],
        timeRange: { from: longAgo, to: longAgo + 60_000 },
      });

      expect(rollups).toEqual({});
    });

    /** @scenario A page with no traces on it shows no events */
    it("issues no query for an empty page", async () => {
      const failingRepo = new SpanStorageClickHouseRepository(async () => {
        throw new Error("resolveClient must not be called");
      });

      await expect(
        failingRepo.getTraceEventRollupsByTraceIds({
          tenantId: rollupTenantId,
          traceIds: [],
          timeRange,
        }),
      ).resolves.toEqual({});
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
        query: "ALTER TABLE stored_spans DELETE WHERE TenantId = {tenantId:String}",
        query_params: { tenantId: hintlessTenantId },
      });
      await ch.exec({
        query: "ALTER TABLE trace_summaries DELETE WHERE TenantId = {tenantId:String}",
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
        const recordingRepo = new SpanStorageClickHouseRepository(async () => recordingClient);

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
        query: "ALTER TABLE stored_spans DELETE WHERE TenantId = {tenantId:String}",
        query_params: { tenantId: hintlessTenantId },
      });
      await ch.exec({
        query: "ALTER TABLE trace_summaries DELETE WHERE TenantId = {tenantId:String}",
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
      const recordingRepo = new SpanStorageClickHouseRepository(async () => recordingClient);

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
      const recordingRepo = new SpanStorageClickHouseRepository(async () => recordingClient);

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
      const recordingRepo = new SpanStorageClickHouseRepository(async () => recordingClient);

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
