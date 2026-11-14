/** @vitest-environment node */

/**
 * A replay batch's event read on a real ClickHouse whose memory is smaller than the batch: one read
 * of the whole batch fails, the replay source reads it in slices and applies every event once.
 * Spec: specs/upgrade/projection-replay-step.feature
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

import type { CutoffInfo, ReplayEvent } from "../../../../replay/replayEventSource.ts";
import { EventingClickHouseReplayEventSource } from "../replay-event-source.clickhouse.ts";

const EVENT_TYPE = "lw.test.span_received";
const AGGREGATES = 100;
const EVENTS_PER_AGGREGATE = 15;
/** Each payload carries 16 KB of hex, so the batch holds about 24 MB of payload. */
const PAYLOAD_RANDOM_BYTES = 8_000;
/** Under the batch's payload, well over one slice's. */
const SERVER_MEMORY_CAP_BYTES = 24_000_000;

const tenantId = `${randomUUID()}-replay-read-memory`;
const aggregateIds = Array.from(
  { length: AGGREGATES },
  (_, index) => `trace-${String(index).padStart(3, "0")}`,
);

let capped: ClickHouseQueryClient;
let uncapped: ClickHouseQueryClient;

/** The server's HTTP interface; `cap` sets `max_memory_usage` on every statement it sends. */
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
    if (cap !== undefined) search.set("max_memory_usage", String(cap));
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
  await setup.command({
    tenantId,
    sql:
      "INSERT INTO event_log (TenantId, IdempotencyKey, AggregateType, AggregateId, EventId, " +
      "EventType, EventVersion, EventTimestamp, EventPayload, EventOccurredAt) " +
      "SELECT {tenantId:String}, concat('event-', toString(number)), 'trace', " +
      "concat('trace-', leftPad(toString(number % {aggregates:UInt32}), 3, '0')), " +
      "concat('event-', toString(number)), {eventType:String}, '2026-11-14', " +
      "1700000000000 + number, " +
      "concat('{\"blob\":\"', hex(randomString({payloadBytes:UInt32})), '\"}'), " +
      "1700000000000 FROM numbers({events:UInt32})",
    params: {
      tenantId,
      aggregates: AGGREGATES,
      eventType: EVENT_TYPE,
      payloadBytes: PAYLOAD_RANDOM_BYTES,
      events: AGGREGATES * EVENTS_PER_AGGREGATE,
    },
  });
}, 120_000);

afterAll(async () => {
  if (uncapped === undefined) return;
  await uncapped.command({
    tenantId,
    sql: "ALTER TABLE event_log DELETE WHERE TenantId = {tenantId:String}",
    params: { tenantId },
  });
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

      await expect(whole).rejects.toThrow(/memory limit/i);
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
