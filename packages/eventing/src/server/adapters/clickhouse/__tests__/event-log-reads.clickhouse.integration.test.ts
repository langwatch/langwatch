/**
 * ADR-202 on ClickHouse 26.8: the `event_log` descriptor matches goose's own text, and each
 * repository read, now built and sent with its tenant setting, returns exactly the rows main's
 * raw text returns. Tenant B reuses tenant A's aggregate and event ids, so a leak shows.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  ClickHouseQueryClient,
  type QueryDriver,
  type QueryRequest,
  TenantGuard,
} from "@langwatch/clickhouse-client";
import type { ClickHouseTableFacts } from "@langwatch/clickhouse-client/builder";
import { startTestClickHouseEndpoints } from "@langwatch/clickhouse-client/testing";
import { beforeAll, describe, expect, it } from "vitest";

import { eventLog } from "../event-log-table.clickhouse.ts";
import {
  EVENT_LOG_SELECT_COLUMNS,
  EventingClickHouseEventRepository,
  mapEventLogRows,
} from "../event-repository.clickhouse.ts";

const MIGRATIONS = resolve(
  import.meta.dirname,
  "../../../../../../clickhouse-migrations/migrations",
);
const A = "project_a";
const B = "project_b";
const C = "project_c";
const TYPE = "trace";
const DAY_MS = 86_400_000;
const NOW = Date.UTC(2026, 10, 14, 12);

let clickhouse: ClickHouseQueryClient;
let driver: QueryDriver;
let repository: EventingClickHouseEventRepository;

/** The goose blocks of one migration that touch `event_log`, with this suite's variables. */
function gooseBlocks(file: string): string[] {
  const up = readFileSync(resolve(MIGRATIONS, file), "utf8").split("-- +goose Down")[0] ?? "";
  return [...up.matchAll(/-- \+goose StatementBegin\n([\s\S]*?)-- \+goose StatementEnd/g)]
    .map(([, block]) => block ?? "")
    .filter((block) => /\$\{CLICKHOUSE_DATABASE\}\.event_log\s/.test(block))
    .map((block) => {
      const text = block
        .replaceAll("${CLICKHOUSE_DATABASE}.", "")
        .replaceAll(
          "${CLICKHOUSE_ENGINE_REPLACING_PREFIX:-ReplacingMergeTree(}",
          "ReplacingMergeTree(",
        )
        .replaceAll("${CLICKHOUSE_STORAGE_POLICY_SETTING}", "")
        .replace(/;\s*$/, "");
      if (text.includes("${")) throw new Error(`An unsubstituted goose variable in ${file}`);
      return text;
    });
}

/** The server's HTTP interface; settings and parameters go as URL parameters. */
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
        { tenantId: request.tenantId, sql: "", settings: request.settings },
        `INSERT INTO ${request.table} FORMAT JSONEachRow\n${rows}`,
      );
    },
    async command(request) {
      await send(request, request.sql);
    },
  };
}

function httpParam(value: unknown): string {
  if (!Array.isArray(value)) return String(value);
  const quoted = value.map(
    (each) => `'${String(each).replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`,
  );
  return `[${quoted.join(",")}]`;
}

const SELECT = `SELECT ${EVENT_LOG_SELECT_COLUMNS} FROM event_log`;
const KEY =
  "TenantId = {tenantId:String} AND AggregateType = {aggregateType:String} AND AggregateId = {aggregateId:String}";
const SINCE = "AND (EventOccurredAt = 0 OR EventOccurredAt >= {occurredAtFromMs:UInt64})";
const UP_TO =
  "AND (EventTimestamp < {upToTimestamp:UInt64} OR (EventTimestamp = {upToTimestamp:UInt64} AND EventId <= {upToEventId:String}))";
const ORDER = "ORDER BY EventTimestamp ASC, EventId ASC";

/** Main's raw text for each read (event-repository.clickhouse.ts before ADR-202): the oracle. */
const MAIN = {
  record: `${SELECT} WHERE ${KEY} AND EventId = {eventId:String} AND (EventOccurredAt = 0 OR (EventOccurredAt >= {occurredAtFromMs:UInt64} AND EventOccurredAt <= {occurredAtToMs:UInt64})) ORDER BY EventTimestamp DESC LIMIT 1`,
  aggregate: (bounded: boolean) => `${SELECT} WHERE ${KEY} ${bounded ? SINCE : ""} ${ORDER}`,
  many: `SELECT TenantId, AggregateId, ${EVENT_LOG_SELECT_COLUMNS} FROM event_log WHERE TenantId IN ({tenantIds:Array(String)}) AND AggregateType = {aggregateType:String} AND AggregateId IN ({aggregateIds:Array(String)}) ORDER BY TenantId ASC, AggregateId ASC, EventTimestamp ASC, EventId ASC`,
  upTo: `${SELECT} WHERE ${KEY} ${UP_TO} ${ORDER}`,
  page: `${SELECT} WHERE ${KEY} ${UP_TO} AND (EventTimestamp > {afterTimestamp:UInt64} OR (EventTimestamp = {afterTimestamp:UInt64} AND EventId > {afterEventId:String})) ${ORDER} LIMIT {limit:UInt32}`,
  count: `SELECT COUNT(DISTINCT EventId) as count FROM event_log WHERE ${KEY} AND (EventTimestamp < {beforeTimestamp:UInt64} OR (EventTimestamp = {beforeTimestamp:UInt64} AND EventId < {beforeEventId:String})) AND EventId != {beforeEventId:String}`,
};

/** Main's raw text sent as main's member adapter sent it (eventing-members.ts before ADR-202). */
async function mainRows<Row>({
  sql,
  params,
  tenantIds,
}: {
  sql: string;
  params: Record<string, unknown>;
  tenantIds?: readonly string[];
}): Promise<Row[]> {
  const sent = { tenantId: A, sql, params, SKIP_COLD_SCAN_CHECK: true as const };
  return (await clickhouse.query<Row>(tenantIds === undefined ? sent : { ...sent, tenantIds }))
    .rows;
}

/** Events e0..e5 of one aggregate; the first has no occurred time, one is a month old. */
function events(tenantId: string, aggregateId: string, offset = 0) {
  return [0, 1, 2, 3, 4, 5].map((index) => ({
    TenantId: tenantId,
    IdempotencyKey: `${aggregateId}-e${index}`,
    AggregateType: TYPE,
    AggregateId: aggregateId,
    EventId: `e${index}`,
    EventType: "lw.test.happened",
    EventVersion: "2026-11-14",
    EventTimestamp: 1_000 * (index + 1) + offset,
    EventPayload: JSON.stringify({ index, tenantId }),
    ProcessingTraceparent: "",
    EventOccurredAt: index === 0 ? 0 : NOW - (index === 1 ? 30 : 1) * DAY_MS,
    _retention_days: 30,
  }));
}

/** The parameter type a stored column binds as (the trace descriptors' rule). */
const bindingOf = (type: string): string =>
  type.replaceAll(/LowCardinality\(([^()]*)\)/g, "$1").replaceAll(/DateTime64\(\d\)/g, "Int64");

beforeAll(async () => {
  const [endpoint] = await startTestClickHouseEndpoints({
    suite: "eventing-event-log-reads",
    names: ["schema"],
    environment: process.env,
  });
  if (!endpoint) throw new Error("No ClickHouse endpoint was provisioned for the suite");
  driver = httpDriver(endpoint.url);
  clickhouse = new ClickHouseQueryClient({
    tenantGuard: new TenantGuard(),
    driver,
    readerDriver: driver,
  });
  await driver.command({ tenantId: "", sql: "DROP TABLE IF EXISTS event_log SYNC" });
  for (const sql of [
    ...gooseBlocks("00002_create_schema.sql"),
    ...gooseBlocks("00032_add_retention_and_size_columns.sql"),
  ]) {
    await driver.command({ tenantId: "", sql });
  }
  for (const [tenantId, offset] of [
    [A, 0],
    [B, 500],
    [C, 250],
  ] as const) {
    await clickhouse.insert({
      tenantId,
      table: "event_log",
      rows: [...events(tenantId, "agg-1", offset), ...events(tenantId, "agg-2", offset)],
    });
  }
  repository = EventingClickHouseEventRepository.create({
    resolveClient: async () => ({
      read: (input) => clickhouse.read(input),
      insert: async () => undefined,
    }),
    retention: { defaultRetentionDays: 30 },
  });
}, 120_000);

const key = { tenantId: A, aggregateType: TYPE, aggregateId: "agg-1" };
type Row = Parameters<typeof mapEventLogRows>[0]["rows"][number];
const map = (rows: Row[]) => mapEventLogRows({ rows, ...key });

describe("event_log's built reads on ClickHouse 26.8", () => {
  it("declares only columns goose gives event_log, binding as their stored types", async () => {
    const stored = new Map(
      (
        await driver.execute<{ name: string; type: string }>({
          tenantId: "",
          sql: "SELECT name, type FROM system.columns WHERE database = currentDatabase() AND table = 'event_log'",
        })
      ).rows.map((each) => [each.name, bindingOf(each.type)]),
    );
    const facts: ClickHouseTableFacts = eventLog.$table;
    const declared = Object.fromEntries(
      facts.columns.map((each) => {
        const ref = Reflect.get(eventLog, each) as { binding: { paramType: string } };
        return [each, ref.binding.paramType];
      }),
    );

    expect(declared).toEqual(
      Object.fromEntries(facts.columns.map((each) => [each, stored.get(each)])),
    );
  });

  it("reads one event by id as main does, never the other tenant's", async () => {
    const window = { fromMs: NOW - 2 * DAY_MS, toMs: NOW };
    const built = await repository.getEventRecord({ ...key, eventId: "e3", occurredAt: window });
    const main = await mainRows<Row>({
      sql: MAIN.record,
      params: {
        ...key,
        eventId: "e3",
        occurredAtFromMs: window.fromMs,
        occurredAtToMs: window.toMs,
      },
    });

    expect([built]).toEqual(map(main));
    expect(Number(built.EventTimestamp)).toBe(4_000);
  });

  it.each([undefined, NOW - 7 * DAY_MS])(
    "reads an aggregate's events as main does, bound %s",
    async (occurredAtFromMs) => {
      const built = await repository.getEventRecords({ ...key, occurredAtFromMs });
      const main = await mainRows<Row>({
        sql: MAIN.aggregate(occurredAtFromMs !== undefined),
        params: { ...key, ...(occurredAtFromMs === undefined ? {} : { occurredAtFromMs }) },
      });

      expect(built).toEqual(map(main));
      expect(built.map((each) => Number(each.EventTimestamp))).toEqual(
        occurredAtFromMs === undefined
          ? [1_000, 2_000, 3_000, 4_000, 5_000, 6_000]
          : [1_000, 3_000, 4_000, 5_000, 6_000],
      );
    },
  );

  it("reads many aggregates across a tenant set as main does, never a tenant outside it", async () => {
    const aggregates = [A, C].flatMap((tenantId) =>
      ["agg-1", "agg-2"].map((aggregateId) => ({ tenantId, aggregateId })),
    );
    const built = await repository.findEventRecordsOfAggregates({
      aggregates,
      aggregateType: TYPE,
    });
    const main = await mainRows<Row & { TenantId: string; AggregateId: string }>({
      sql: MAIN.many,
      params: { tenantIds: [A, C], aggregateType: TYPE, aggregateIds: ["agg-1", "agg-2"] },
      tenantIds: [A, C],
    });

    expect(built).toEqual(
      main.flatMap((row) =>
        mapEventLogRows({
          rows: [row],
          tenantId: row.TenantId,
          aggregateType: TYPE,
          aggregateId: row.AggregateId,
        }),
      ),
    );
    expect(new Set(built.map((each) => each.TenantId))).toEqual(new Set([A, C]));
    expect(built).toHaveLength(24);
  });

  it("reads up to an event, and a page after a cursor, as main does", async () => {
    const upTo = { ...key, upToTimestamp: 5_000, upToEventId: "e4" };
    const built = await repository.getEventRecordsUpTo(upTo);
    expect(built).toEqual(map(await mainRows<Row>({ sql: MAIN.upTo, params: upTo })));
    expect(built).toHaveLength(5);

    const page = { after: { timestamp: 2_000, eventId: "e1" }, limit: 2 };
    const builtPage = await repository.getEventRecordsUpToPaged({ ...upTo, ...page });
    const mainPage = await mainRows<Row>({
      sql: MAIN.page,
      params: { ...upTo, afterTimestamp: 2_000, afterEventId: "e1", limit: 2 },
    });
    expect(builtPage).toEqual(map(mainPage));
    expect(builtPage.map((each) => each.EventId)).toEqual(["e2", "e3"]);
  });

  it("counts the events before an event as main does", async () => {
    const before = { ...key, beforeTimestamp: 4_000, beforeEventId: "e3" };
    const built = await repository.countEventRecords(before);
    const [main] = await mainRows<{ count: string }>({ sql: MAIN.count, params: before });

    expect(built).toBe(Number(main?.count));
    expect(built).toBe(3);
  });
});
