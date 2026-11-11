/** @vitest-environment node */

/**
 * The event explorer on a real ClickHouse that sends 64-bit integers unquoted: event times still
 * come back as text, which the ops contract declares, and the search keeps numeric order.
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

import { EventingClickHouseEventExplorer } from "../event-explorer.clickhouse.ts";

const tenantId = `${randomUUID()}-event-explorer`;
// Twelve digits against thirteen: compared as text, the older time would sort first.
const OLDER_MS = 999_999_999_999;
const NEWER_MS = 1_000_000_000_000;

let clickhouse: ClickHouseQueryClient;

/** The server's HTTP interface, pinned to unquoted 64-bit integers whatever its default. */
function unquotedIntegersDriver(url: string): QueryDriver {
  const endpoint = new URL(url);
  const database = endpoint.pathname.replace(/^\//, "") || "default";
  const authorization = `Basic ${btoa(`${decodeURIComponent(endpoint.username)}:${decodeURIComponent(endpoint.password)}`)}`;
  const send = async (request: QueryRequest, body: string): Promise<string> => {
    const search = new URLSearchParams({
      database,
      output_format_json_quote_64bit_integers: "0",
    });
    for (const [name, value] of Object.entries(request.params ?? {})) {
      search.set(`param_${name}`, httpParam(value));
    }
    const response = await fetch(`${endpoint.origin}/?${search.toString()}`, {
      method: "POST",
      headers: { authorization },
      body,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(text);
    return text;
  };
  return {
    async execute<Row>(request: QueryRequest) {
      const text = await send(request, `${request.sql}\nFORMAT JSONEachRow`);
      return {
        rows: text
          .split("\n")
          .filter((line) => line.trim().length > 0)
          .map((line) => JSON.parse(line) as Row),
      };
    },
    async insert(request) {
      const rows = request.rows.map((row) => JSON.stringify(row)).join("\n");
      await send(
        { tenantId: request.tenantId, sql: "" },
        `INSERT INTO ${request.table} FORMAT JSONEachRow\n${rows}`,
      );
    },
    async command(request) {
      await send(request, request.sql);
    },
  };
}

/** One HTTP query parameter: arrays as ClickHouse literals, everything else as text. */
function httpParam(value: unknown): string {
  if (!Array.isArray(value)) return String(value);
  const quoted = value.map((each) =>
    typeof each === "number"
      ? String(each)
      : `'${String(each).replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`,
  );
  return `[${quoted.join(",")}]`;
}

function eventRow({ aggregateId, timestampMs }: { aggregateId: string; timestampMs: number }) {
  const eventId = `${aggregateId}-event`;
  return {
    TenantId: tenantId,
    IdempotencyKey: eventId,
    AggregateType: "thing",
    AggregateId: aggregateId,
    EventId: eventId,
    EventType: "lw.test.thing_happened",
    EventVersion: "2026-11-12",
    EventTimestamp: timestampMs,
    EventPayload: "{}",
    EventOccurredAt: timestampMs,
    _retention_days: 0,
  };
}

beforeAll(async () => {
  const [endpoint] = await startTestClickHouseEndpoints({
    suite: "eventing-event-explorer",
    names: ["schema"],
    environment: process.env,
  });
  if (!endpoint) throw new Error("No ClickHouse endpoint was provisioned for the suite");
  const driver = unquotedIntegersDriver(endpoint.url);
  clickhouse = new ClickHouseQueryClient({ tenantGuard: new TenantGuard(), driver });
  // The event log as goose 00002 and 00032 shape it.
  await driver.command({
    tenantId,
    sql:
      "CREATE TABLE IF NOT EXISTS event_log (TenantId String, IdempotencyKey String, " +
      "AggregateType LowCardinality(String), AggregateId String, EventId String, " +
      "EventType LowCardinality(String), EventVersion LowCardinality(String), " +
      "EventTimestamp UInt64, EventPayload String, ProcessingTraceparent String DEFAULT '', " +
      "EventOccurredAt UInt64 DEFAULT 0, _retention_days UInt16 DEFAULT 308) " +
      "ENGINE = ReplacingMergeTree(EventTimestamp) " +
      "PARTITION BY toYearWeek(toDateTime64(EventOccurredAt / 1000, 3)) " +
      "ORDER BY (TenantId, AggregateType, AggregateId, IdempotencyKey)",
  });
  await clickhouse.insert({
    tenantId,
    table: "event_log",
    rows: [
      eventRow({ aggregateId: "older", timestampMs: OLDER_MS }),
      eventRow({ aggregateId: "newer", timestampMs: NEWER_MS }),
    ],
  });
}, 120_000);

afterAll(async () => {
  if (clickhouse === undefined) return;
  await clickhouse.command({
    tenantId,
    sql: "ALTER TABLE event_log DELETE WHERE TenantId = {tenantId:String}",
    params: { tenantId },
  });
});

describe("the event explorer over a server that sends 64-bit integers unquoted", () => {
  it("is reading from a server that really sends the raw column as a number", async () => {
    const { rows } = await clickhouse.query<{ EventTimestamp: unknown }>({
      tenantId,
      sql: "SELECT EventTimestamp FROM event_log WHERE TenantId = {tenantId:String} LIMIT 1",
      params: { tenantId },
    });
    expect(typeof rows[0]?.EventTimestamp).toBe("number");
  });

  describe("when an operator searches a tenant's aggregates", () => {
    it("returns each aggregate's last event time as text, newest first", async () => {
      const explorer = EventingClickHouseEventExplorer.create({ clickhouse });

      const found = await explorer.searchAggregates({ query: "", tenantIds: [tenantId] });

      expect(
        found.map(({ aggregateId, lastEventTime }) => ({ aggregateId, lastEventTime })),
      ).toEqual([
        { aggregateId: "newer", lastEventTime: String(NEWER_MS) },
        { aggregateId: "older", lastEventTime: String(OLDER_MS) },
      ]);
    });
  });

  describe("when an operator opens one aggregate's history", () => {
    it("returns each event's time as text", async () => {
      const explorer = EventingClickHouseEventExplorer.create({ clickhouse });

      const events = await explorer.findEventsByAggregate({
        aggregateId: "newer",
        tenantId,
        limit: 10,
      });

      expect(events.map(({ eventId, eventTimestamp }) => ({ eventId, eventTimestamp }))).toEqual([
        { eventId: "newer-event", eventTimestamp: String(NEWER_MS) },
      ]);
    });
  });
});
