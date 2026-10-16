/** @vitest-environment node */

/**
 * The event log's aggregate index on a real ClickHouse (goose 00111 over an `event_log` fixture):
 * replays bounded to an aggregate's weeks, unknown times kept, unseen aggregates read unbounded.
 * Spec: specs/clickhouse/id-index-reads.feature
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  ClickHouseQueryClient,
  fillOwnerIdIndexes,
  type QueryDriver,
  type QueryRequest,
  TenantGuard,
} from "@langwatch/clickhouse-client";
import {
  startTestClickHouseEndpoints,
  partsAfterPartitionPruning,
} from "@langwatch/clickhouse-client/testing";
import { nowInstant } from "@langwatch/time";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { ReplayEvent } from "../../../replay/replayEventSource.ts";
import { EventingClickHouseEventRepository } from "../../adapters/clickhouse/event-repository.clickhouse.ts";
import { EventingClickHouseReplayEventSource } from "../../adapters/clickhouse/replay-event-source.clickhouse.ts";
import type { EventingClickHouseClientResolver } from "../../clickhouse-client-resolver.ts";
import {
  EVENT_LOG_ID_INDEX,
  type EventLogIdIndex,
  eventLogIdIndexReadiness,
  eventLogOccurredRange,
} from "../event-log-id-index.ts";

const DAY_MS = 86_400_000;
const EVENT_TYPE = "lw.test.thing_happened";
const GOOSE = resolve(
  import.meta.dirname,
  "../../../../../clickhouse-migrations/migrations/00111_event_log_id_index.sql",
);

const tenantId = `${randomUUID()}-event-log-index`;
const todayMs = nowInstant().epochMilliseconds;
const daysAgo = (days: number) => todayMs - days * DAY_MS;
// A year ago, three consecutive weeks; the decoys sit in other weeks, keys either side of ours.
const replayedDays = [365, 358, 351];
const decoyDays = [400, 300, 200];
const decoyIds = ["!decoy", "~decoy"];

let statements: QueryRequest[] = [];
let clickhouse: ClickHouseQueryClient;
let sql: (query: string, params?: Record<string, unknown>) => Promise<unknown[]>;

/** The server's HTTP interface, so the suite needs no client package beyond clickhouse-client. */
function httpDriver(url: string): QueryDriver {
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
      statements.push(request);
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

/** JSONEachRow lines, typed by the caller as the vendor client's `json<Row>()` is. */
function rowsOf<Row>(text: string): Row[] {
  return text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
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

/** Active `event_log` parts in the weekly partitions these occurred times fall in, any tenant's. */
async function activeParts(occurredAtMs: readonly number[]): Promise<number> {
  const [row] = await sql(
    "SELECT count() AS parts FROM system.parts WHERE database = currentDatabase() " +
      "AND table = 'event_log' AND active AND partition IN (" +
      "SELECT toString(toYearWeek(toDateTime64(at / 1000, 3))) " +
      "FROM (SELECT arrayJoin({occurredAtMs:Array(UInt64)}) AS at))",
    { occurredAtMs },
  );
  return Number(Reflect.get(Object(row), "parts"));
}

function eventRow({
  aggregateId,
  occurredAtMs,
  index,
}: {
  aggregateId: string;
  occurredAtMs: number;
  index: number;
}) {
  const eventId = `${aggregateId}-${index}`;
  return {
    TenantId: tenantId,
    IdempotencyKey: eventId,
    AggregateType: "thing",
    AggregateId: aggregateId,
    EventId: eventId,
    EventType: EVENT_TYPE,
    EventVersion: "2026-10-11",
    EventTimestamp: todayMs + index,
    EventPayload: "{}",
    EventOccurredAt: occurredAtMs,
    _retention_days: 0,
  };
}

/** One insert per aggregate, so each holds one part per week it spans. */
async function store(aggregateId: string, occurredAtMs: readonly number[]): Promise<void> {
  await clickhouse.insert({
    tenantId,
    table: "event_log",
    rows: occurredAtMs.map((at, index) => eventRow({ aggregateId, occurredAtMs: at, index })),
  });
}

const index = (): EventLogIdIndex => ({
  reader: clickhouse,
  readiness: { isReady: () => true },
});

beforeAll(async () => {
  const [endpoint] = await startTestClickHouseEndpoints({
    suite: "eventing-event-log-id-index",
    names: ["schema"],
    environment: process.env,
  });
  if (!endpoint) throw new Error("No ClickHouse endpoint was provisioned for the suite");
  const driver = httpDriver(endpoint.url);
  sql = async (query, params) =>
    (await driver.execute<unknown>({ tenantId, sql: query, params })).rows;
  clickhouse = new ClickHouseQueryClient({ tenantGuard: new TenantGuard(), driver });
  // The source as goose 00002 and 00032 shape it; the index and its view from goose 00111 itself.
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
  const up = readFileSync(GOOSE, "utf8").split("-- +goose Down")[0] ?? "";
  for (const [, statement] of up.matchAll(
    /-- \+goose StatementBegin\n([\s\S]*?)-- \+goose StatementEnd/g,
  )) {
    await driver.command({
      tenantId,
      sql: (statement ?? "")
        .replaceAll("${CLICKHOUSE_DATABASE}.", "")
        .replaceAll(
          "${CLICKHOUSE_ENGINE_AGGREGATING:-AggregatingMergeTree()}",
          "AggregatingMergeTree()",
        )
        .replace(/;\s*$/, ""),
    });
  }

  // A reused database keeps an earlier run's marker row (TenantId ''); start with none.
  await driver.command({
    tenantId,
    sql: "ALTER TABLE event_log_id_index DELETE WHERE TenantId = '' SETTINGS mutations_sync = 2",
  });

  await store("replayed", [...replayedDays.map(daysAgo), 0]);
  await store("last-month", [daysAgo(40), daysAgo(33), 0]);
  await store("unseen", [0, 0]);
  for (const days of decoyDays) {
    for (const id of decoyIds) await store(`${id}-${days}`, [daysAgo(days)]);
  }
}, 120_000);

beforeEach(() => {
  statements = [];
});

afterAll(async () => {
  if (clickhouse === undefined) return;
  for (const table of ["event_log", "event_log_id_index"]) {
    await clickhouse.command({
      tenantId,
      sql: `ALTER TABLE ${table} DELETE WHERE TenantId = {tenantId:String}`,
      params: { tenantId },
    });
  }
});

describe("the event log's aggregate index", () => {
  describe("given an aggregate whose events span three weeks, a year ago", () => {
    /** @scenario "replaying an aggregate reads only the weeks its events span" */
    it("bounds the replay to those weeks and still applies its event with no occurred time", async () => {
      const source = new EventingClickHouseReplayEventSource({
        clickhouse,
        lean: (event) => event,
        eventLogIndex: index(),
      });

      const { cutoffs, occurredAtBounds } = await source.getBoundedCutoffs({
        tenantId,
        aggregateTypes: ["thing"],
        aggregateIds: ["replayed"],
        eventTypes: [EVENT_TYPE],
      });
      statements = [];
      const applied: ReplayEvent[] = [];
      await source.streamEventsForAggregates({
        tenantId,
        aggregateIds: ["replayed"],
        eventTypes: [EVENT_TYPE],
        cutoffs,
        ...(occurredAtBounds === undefined ? {} : { occurredAtBounds }),
        onEvent: (event) => {
          applied.push(event);
        },
      });

      expect(occurredAtBounds).toEqual({ minMs: daysAgo(365), maxMs: daysAgo(351) });
      expect(applied).toHaveLength(4);
      const [bounded] = statements;
      if (bounded === undefined) throw new Error("the replay sent no read");
      const unbounded = {
        ...bounded,
        sql: bounded.sql.replace(/AND \(\s*EventOccurredAt = 0[\s\S]*?\)\s*\)/, ""),
      };
      // Exactly the parts of its three weeks and the unknown-time partition, never a decoy's week.
      expect(await partsAfterPartitionPruning({ query: sql, request: bounded })).toBe(
        await activeParts([...replayedDays.map(daysAgo), 0]),
      );
      expect(await partsAfterPartitionPruning({ query: sql, request: bounded })).toBeLessThan(
        await partsAfterPartitionPruning({ query: sql, request: unbounded }),
      );
    });

    /** @scenario "replaying an aggregate reads only the weeks its events span" */
    it("bounds a fold's read below by the aggregate's first week", async () => {
      const resolveClient: EventingClickHouseClientResolver = async (tenant) => ({
        query: async (request) => ({
          json: async <Row>() =>
            (
              await clickhouse.query<Row>({
                tenantId: tenant,
                sql: request.query,
                ...(request.query_params === undefined ? {} : { params: request.query_params }),
                ...(request.SKIP_COLD_SCAN_CHECK === true ? { SKIP_COLD_SCAN_CHECK: true } : {}),
              })
            ).rows,
        }),
        insert: async () => undefined,
      });
      const repository = EventingClickHouseEventRepository.createForEventReads({
        resolveClient,
        eventLogIndex: index(),
      });

      const records = await repository.getEventRecords({
        tenantId,
        aggregateType: "thing",
        aggregateId: "replayed",
      });

      expect(records).toHaveLength(4);
      const read = statements.find((each) => each.sql.includes("FROM event_log\n"));
      expect(read?.params).toMatchObject({ occurredAtFromMs: daysAgo(365) });
    });

    it("bounds a read of many aggregates below by the earliest of their first weeks", async () => {
      const resolveClient: EventingClickHouseClientResolver = async (tenant) => ({
        query: async (request) => ({
          json: async <Row>() =>
            (
              await clickhouse.query<Row>({
                tenantId: tenant,
                sql: request.query,
                ...(request.query_params === undefined ? {} : { params: request.query_params }),
                ...(request.tenantIds === undefined ? {} : { tenantIds: request.tenantIds }),
                ...(request.SKIP_COLD_SCAN_CHECK === true ? { SKIP_COLD_SCAN_CHECK: true } : {}),
              })
            ).rows,
        }),
        insert: async () => undefined,
      });
      const repository = EventingClickHouseEventRepository.createForEventReads({
        resolveClient,
        eventLogIndex: index(),
      });

      const records = await repository.findEventRecordsOfAggregates({
        aggregates: [
          { tenantId, aggregateId: "replayed" },
          { tenantId, aggregateId: "last-month" },
        ],
        aggregateType: "thing",
      });

      expect(records).toHaveLength(7);
      const read = statements.find((each) => each.sql.includes("FROM event_log\n"));
      expect(read?.params).toMatchObject({ occurredAtFromMs: daysAgo(365) });
    });
  });

  describe("given an aggregate with events last month and one with no occurred time", () => {
    /** @scenario "events with an unknown occurred time do not widen an aggregate's range" */
    it("answers a range covering last month only", async () => {
      const range = await eventLogOccurredRange({
        index: index(),
        read: "aggregate",
        tenantId,
        aggregateTypes: ["thing"],
        aggregateIds: ["last-month"],
      });

      expect(range).toEqual({ fromMs: daysAgo(40), toMs: daysAgo(33) });
    });
  });

  describe("given an event log holding rows and an index with no marker row", () => {
    /** @scenario "readers trust the index only once its marker row is written" */
    it("reads unbounded until the fill writes the marker, then bounded by the index", async () => {
      const readiness = eventLogIdIndexReadiness({ clickhouse });
      const rangeOf = () =>
        eventLogOccurredRange({
          index: { reader: clickhouse, readiness },
          read: "aggregate",
          tenantId,
          aggregateTypes: ["thing"],
          aggregateIds: ["last-month"],
        });

      expect(await readiness.check({ target: "shared" })).toBe(false);
      expect(await rangeOf()).toBeNull();

      await fillOwnerIdIndexes({
        clickhouse,
        indexes: [EVENT_LOG_ID_INDEX],
        checkpoint: { resumeFrom: null, save: async () => undefined },
        signal: new AbortController().signal,
        raiseRetention: async () => undefined,
      });

      expect(await readiness.check({ target: "shared" })).toBe(true);
      expect(await rangeOf()).toEqual({ fromMs: daysAgo(40), toMs: daysAgo(33) });
    });
  });

  describe("given the index ready and an aggregate whose only events have no occurred time", () => {
    /** @scenario "an aggregate the index has not seen reads its whole history" */
    it("misses the index and replays every event through the unbounded path", async () => {
      const source = new EventingClickHouseReplayEventSource({
        clickhouse,
        lean: (event) => event,
        eventLogIndex: index(),
      });

      const { cutoffs, occurredAtBounds } = await source.getBoundedCutoffs({
        tenantId,
        aggregateTypes: ["thing"],
        aggregateIds: ["unseen"],
        eventTypes: [EVENT_TYPE],
      });
      const applied: ReplayEvent[] = [];
      await source.streamEventsForAggregates({
        tenantId,
        aggregateIds: ["unseen"],
        eventTypes: [EVENT_TYPE],
        cutoffs,
        ...(occurredAtBounds === undefined ? {} : { occurredAtBounds }),
        onEvent: (event) => {
          applied.push(event);
        },
      });

      expect(
        statements.some(
          (each) =>
            each.sql.includes("FROM event_log\n") && each.sql.includes("min(EventOccurredAt)"),
        ),
      ).toBe(true);
      expect(applied).toHaveLength(2);
    });
  });
});
