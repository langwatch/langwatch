/** @vitest-environment node */

/**
 * On a ClickHouse with less memory than the batch, its whole read fails and is read in slices,
 * each event applied once; one aggregate over it alone is read in pages. Spec:
 * specs/upgrade/projection-replay-step.feature
 */
import { randomUUID } from "node:crypto";

import {
  ClickHouseQueryClient,
  type QueryDriver,
  type QueryRequest,
  TenantGuard,
} from "@langwatch/clickhouse-client";
import { startTestClickHouseEndpoints } from "@langwatch/clickhouse-client/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { pageAggregateEvents } from "../../../../replay/replayEngine.ts";
import type { CutoffInfo, ReplayEvent } from "../../../../replay/replayEventSource.ts";
import { isQueryMemoryLimitExceeded } from "../../../../services/errorHandling.ts";
import { EventingClickHouseReplayEventSource } from "../replay-event-source.clickhouse.ts";

const EVENT_TYPE = "lw.test.span_received";
const AGGREGATES = 100;
const EVENTS_PER_AGGREGATE = 15;
/** Each payload carries 100 KB of hex, so the batch holds about 150 MB of payload. */
const PAYLOAD_RANDOM_BYTES = 50_000;
/** Under the batch's payload, well over one slice's. */
const SERVER_MEMORY_CAP_BYTES = 80_000_000;
/** 200 events of 100 KB: about 20 MB an insert. */
const SEED_CHUNK_EVENTS = 200;

const tenantId = `${randomUUID()}-replay-read-memory`;
const aggregateIds = Array.from(
  { length: AGGREGATES },
  (_, index) => `trace-${String(index).padStart(3, "0")}`,
);

/** One tenant: a lone aggregate of about 150 MB, near 2x the per-query cap, and one a tenth. */
const pagedTenantId = `${randomUUID()}-replay-paged-aggregate`;
const LONE_AGGREGATES = { "trace-large": 1_500, "trace-small": 150 } as const;
/** Page caps scaled to the test server's memory, as AGGREGATE_PAGE is to production's. */
const TEST_PAGE = { maxEvents: 1_000, maxPayloadBytes: 3 * 1024 * 1024 };

let capped: ClickHouseQueryClient;
let uncapped: ClickHouseQueryClient;

/**
 * The server's HTTP interface. With `cap`, every statement gets `max_memory_usage` and
 * `max_threads: 1`. Threads are pinned because memory per read can grow with the
 * server's thread count.
 */
function httpDriver({ url, cap }: { url: string; cap?: number }): QueryDriver {
  const endpoint = new URL(url);
  const database = endpoint.pathname.replace(/^\//, "") || "default";
  const authorization = `Basic ${btoa(`${decodeURIComponent(endpoint.username)}:${decodeURIComponent(endpoint.password)}`)}`;
  const send = async (request: QueryRequest, body: string): Promise<string> => {
    const search = new URLSearchParams({ database });
    for (const [name, value] of Object.entries(request.params ?? {})) {
      search.set(`param_${name}`, httpParam(value));
    }
    for (const [name, value] of Object.entries(request.settings ?? {})) {
      search.set(name, String(value));
    }
    if (cap !== undefined) {
      search.set("max_memory_usage", String(cap));
      search.set("max_threads", "1");
    }
    const response = await fetch(`${endpoint.origin}/?${search.toString()}`, {
      method: "POST",
      headers: { authorization },
      body,
    });
    const text = await response.text();
    if (!response.ok) throw Object.assign(new Error(text), { code: /Code: (\d+)/.exec(text)?.[1] });
    return text;
  };
  return {
    async execute<Row>(request: QueryRequest) {
      const text = await send(request, `${request.sql}\nFORMAT JSONEachRow`);
      return { rows: rowsOf<Row>(text) };
    },
    async insert(request) {
      const rows = request.rows.map((row) => JSON.stringify(row)).join("\n");
      await send(
        { tenantId: request.tenantId, sql: "", settings: request.settings },
        `INSERT INTO ${request.table} FORMAT JSONEachRow\n${rows}`,
      );
    },
    async command(request) {
      await send(request, request.sql);
    },
  };
}

function rowsOf<Row>(text: string): Row[] {
  return text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

/** One HTTP query parameter: arrays as ClickHouse literals, everything else as text. */
function httpParam(value: unknown): string {
  if (!Array.isArray(value)) return String(value);
  const quoted = value.map((each) => `'${String(each).replaceAll("'", "\\'")}'`);
  return `[${quoted.join(",")}]`;
}

/** Each aggregate's events, in the `(EventTimestamp, EventId)` order replay applies them. */
function expectedOrder(): string[] {
  return aggregateIds.flatMap((aggregateId, aggregate) =>
    Array.from(
      { length: EVENTS_PER_AGGREGATE },
      (_, event) => `${aggregateId}:${event * AGGREGATES + aggregate}`,
    ),
  );
}

/** A source over the capped server, reading with its default budget. */
function cappedSource(): EventingClickHouseReplayEventSource {
  return new EventingClickHouseReplayEventSource({ clickhouse: capped, lean: (event) => event });
}

/** A lone aggregate's events through its bulk read, in the order applied. */
async function bulkRead(aggregateId: keyof typeof LONE_AGGREGATES): Promise<string[]> {
  const applied: string[] = [];
  await cappedSource().streamEventsForAggregates({
    tenantId: pagedTenantId,
    aggregateIds: [aggregateId],
    eventTypes: [EVENT_TYPE],
    cutoffs: new Map<string, CutoffInfo>(),
    onEvent: (event: ReplayEvent) => {
      applied.push(event.id);
    },
  });
  return applied;
}

/** A lone aggregate's events through its pages, in the order applied, and each page's size. */
async function pagedRead(aggregateId: keyof typeof LONE_AGGREGATES) {
  const source = cappedSource();
  const load = source.loadAggregateEvents.bind(source);
  const pages: { events: number; payloadBytes: number }[] = [];
  source.loadAggregateEvents = async (input) => {
    const events = await load(input);
    const payloadBytes = events.reduce((sum, event) => sum + JSON.stringify(event.data).length, 0);
    pages.push({ events: events.length, payloadBytes });
    return events;
  };
  const last = LONE_AGGREGATES[aggregateId] - 1;
  const applied: string[] = [];
  await pageAggregateEvents({
    eventSource: source,
    signal: undefined,
    log: { write: () => undefined },
    page: TEST_PAGE,
    tenantId: pagedTenantId,
    aggregateIds: [aggregateId],
    eventTypes: [EVENT_TYPE],
    cutoffs: new Map([
      [
        `${pagedTenantId}:trace:${aggregateId}`,
        { timestamp: 1_700_000_000_000 + last, eventId: `event-${last}` },
      ],
    ]),
    onEvent: (event) => {
      applied.push(event.id);
    },
  });
  return { applied, pages };
}

/** Every event the source applies for the batch, as `aggregate:event number`. */
async function replayBatch(source: EventingClickHouseReplayEventSource): Promise<string[]> {
  const applied: string[] = [];
  await source.streamEventsForAggregates({
    tenantId,
    aggregateIds,
    eventTypes: [EVENT_TYPE],
    cutoffs: new Map<string, CutoffInfo>(),
    onEvent: (event: ReplayEvent) => {
      applied.push(`${event.aggregateId}:${event.id.slice("event-".length)}`);
    },
  });
  return applied;
}

/**
 * Inserts `events` events in sequential chunks of SEED_CHUNK_EVENTS, so no insert holds more than
 * about 20 MB: the CI server caps its total memory at 1 GiB (Code 241, "(total)").
 */
async function seedEvents({
  setup,
  tenant,
  aggregateIdSql,
  params,
  events,
}: {
  setup: QueryDriver;
  tenant: string;
  aggregateIdSql: string;
  params: Record<string, unknown>;
  events: number;
}): Promise<void> {
  for (let from = 0; from < events; from += SEED_CHUNK_EVENTS) {
    await setup.command({
      tenantId: tenant,
      sql:
        "INSERT INTO event_log (TenantId, IdempotencyKey, AggregateType, AggregateId, EventId, " +
        "EventType, EventVersion, EventTimestamp, EventPayload, EventOccurredAt) " +
        "SELECT {tenantId:String}, concat('event-', toString(number)), 'trace', " +
        `${aggregateIdSql}, concat('event-', toString(number)), {eventType:String}, ` +
        "'2026-11-14', 1700000000000 + number, " +
        "concat('{\"blob\":\"', hex(randomString({payloadBytes:UInt32})), '\"}'), " +
        "1700000000000 FROM numbers({from:UInt32}, {count:UInt32})",
      params: {
        ...params,
        tenantId: tenant,
        eventType: EVENT_TYPE,
        payloadBytes: PAYLOAD_RANDOM_BYTES,
        from,
        count: Math.min(SEED_CHUNK_EVENTS, events - from),
      },
    });
  }
}

beforeAll(async () => {
  const [endpoint] = await startTestClickHouseEndpoints({
    suite: "eventing-replay-read-memory",
    names: ["schema"],
    environment: process.env,
  });
  if (!endpoint) throw new Error("No ClickHouse endpoint was provisioned for the suite");
  const setup = httpDriver({ url: endpoint.url });
  uncapped = new ClickHouseQueryClient({ tenantGuard: new TenantGuard(), driver: setup });
  capped = new ClickHouseQueryClient({
    tenantGuard: new TenantGuard(),
    driver: httpDriver({ url: endpoint.url, cap: SERVER_MEMORY_CAP_BYTES }),
  });
  // The source as goose 00002 shapes it, payload codec included.
  await setup.command({
    tenantId,
    sql:
      "CREATE TABLE IF NOT EXISTS event_log (TenantId String, IdempotencyKey String, " +
      "AggregateType LowCardinality(String), AggregateId String, EventId String, " +
      "EventType LowCardinality(String), EventVersion LowCardinality(String), " +
      "EventTimestamp UInt64, EventPayload String CODEC(ZSTD(3)), " +
      "ProcessingTraceparent String DEFAULT '', EventOccurredAt UInt64 DEFAULT 0, " +
      "_retention_days UInt16 DEFAULT 308) " +
      "ENGINE = ReplacingMergeTree(EventTimestamp) " +
      "PARTITION BY toYearWeek(toDateTime64(EventOccurredAt / 1000, 3)) " +
      "ORDER BY (TenantId, AggregateType, AggregateId, IdempotencyKey)",
  });
  // Event n belongs to aggregate n % 100 and was recorded at n, so aggregates interleave in time.
  await seedEvents({
    setup,
    tenant: tenantId,
    aggregateIdSql: "concat('trace-', leftPad(toString(number % {aggregates:UInt32}), 3, '0'))",
    params: { aggregates: AGGREGATES },
    events: AGGREGATES * EVENTS_PER_AGGREGATE,
  });
  for (const [aggregateId, events] of Object.entries(LONE_AGGREGATES)) {
    await seedEvents({
      setup,
      tenant: pagedTenantId,
      aggregateIdSql: "{aggregateId:String}",
      params: { aggregateId },
      events,
    });
  }
}, 120_000);

afterAll(async () => {
  if (uncapped === undefined) return;
  for (const each of [tenantId, pagedTenantId]) {
    await uncapped.command({
      tenantId: each,
      sql: "ALTER TABLE event_log DELETE WHERE TenantId = {tenantId:String}",
      params: { tenantId: each },
    });
  }
});

describe("a replay batch's event read", () => {
  describe("given a batch whose payloads outgrow the server's memory for one read", () => {
    it("fails as a single read of the whole batch, sorted by aggregate", async () => {
      const whole = capped.query({
        tenantId,
        sql:
          "SELECT EventId, EventPayload, AggregateId FROM event_log " +
          "WHERE TenantId = {tenantId:String} AND EventType IN ({eventTypes:Array(String)}) " +
          "AND AggregateId IN ({aggregateIds:Array(String)}) " +
          "ORDER BY AggregateId, EventTimestamp ASC, EventId ASC",
        params: { tenantId, eventTypes: [EVENT_TYPE], aggregateIds },
      });

      await expect(whole).rejects.toMatchObject({ code: "241" });
    });

    /** @scenario "A batch's events are read in slices sized by their payload" */
    it("reads it in slices within the budget and applies every event once, in order", async () => {
      const source = new EventingClickHouseReplayEventSource({
        clickhouse: capped,
        lean: (event) => event,
        readBudget: { maxEvents: 200, maxPayloadBytes: 3 * 1024 * 1024 },
      });

      expect(await replayBatch(source)).toEqual(expectedOrder());
    });

    /** @scenario "A slice over the server's memory before it applied an event is read as halves" */
    it("reads a slice over the memory limit again as halves and applies every event once", async () => {
      const source = new EventingClickHouseReplayEventSource({
        clickhouse: capped,
        lean: (event) => event,
        readBudget: {
          maxEvents: Number.MAX_SAFE_INTEGER,
          maxPayloadBytes: Number.MAX_SAFE_INTEGER,
        },
      });

      expect(await replayBatch(source)).toEqual(expectedOrder());
    });
  });
});

describe("a lone aggregate's event read", () => {
  describe("given one aggregate whose payloads outgrow the server's memory for one read", () => {
    /** @scenario "A lone aggregate over the server's memory fails its bulk read and completes in pages" */
    it("fails its bulk read as one statement over the per-query memory limit", async () => {
      const failure: unknown = await bulkRead("trace-large").catch((error: unknown) => error);

      expect(isQueryMemoryLimitExceeded(failure)).toBe(true);
    });

    /** @scenario "A lone aggregate over the server's memory fails its bulk read and completes in pages" */
    it("reads it in pages within the caps and applies every event once, in order", async () => {
      const { applied, pages } = await pagedRead("trace-large");

      expect(applied).toEqual(
        Array.from({ length: LONE_AGGREGATES["trace-large"] }, (_, n) => `event-${n}`),
      );
      for (const page of pages) {
        expect(page.events).toBeLessThanOrEqual(TEST_PAGE.maxEvents);
        expect(page.payloadBytes).toBeLessThanOrEqual(TEST_PAGE.maxPayloadBytes);
      }
    }, 120_000);
  });

  describe("given an aggregate a tenth that size, small enough for its bulk read", () => {
    /** @scenario "A paged aggregate's pages stay within the page caps at any size" */
    it("reads it in pages within the same caps, applying what its bulk read applies", async () => {
      const { applied, pages } = await pagedRead("trace-small");

      expect(applied).toEqual(await bulkRead("trace-small"));
      for (const page of pages) {
        expect(page.events).toBeLessThanOrEqual(TEST_PAGE.maxEvents);
        expect(page.payloadBytes).toBeLessThanOrEqual(TEST_PAGE.maxPayloadBytes);
      }
    }, 120_000);
  });
});
