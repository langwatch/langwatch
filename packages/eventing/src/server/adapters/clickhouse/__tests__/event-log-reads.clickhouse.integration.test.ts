/**
 * ADR-202 on ClickHouse 26.8: the `event_log` descriptor matches goose's own text, and each
 * repository read, now built and sent with its tenant setting, returns exactly the rows main's
 * raw text returns, explorer and replay included. Tenant B reuses tenant A's ids, so a leak shows.
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

import { REPLAY_ALL_TENANTS } from "../../../../replay/replayEventSource.ts";
import { EventLogRetention } from "../../../tables/event-log-retention.ts";
import {
  aggregateDiscoveryRead,
  aggregateHistoryRead,
  aggregateSearchRead,
} from "../event-explorer-reads.clickhouse.ts";
import { eventLog } from "../event-log-table.clickhouse.ts";
import {
  EVENT_LOG_SELECT_COLUMNS,
  EventingClickHouseEventRepository,
  mapEventLogRows,
} from "../event-repository.clickhouse.ts";
import {
  affectedAggregatesRead,
  aggregateEventsPageRead,
  cutoffEventsRead,
  discoveredEventCountRead,
  occurredAtBoundsRead,
  replayTenantsRead,
  streamedEventsRead,
} from "../replay-reads.clickhouse.ts";

const MIGRATIONS = resolve(
  import.meta.dirname,
  "../../../../../../clickhouse-migrations/migrations",
);
const A = "project_a";
const B = "project_b";
const C = "project_c";
const TYPE = "trace";
const HAPPENED = "lw.test.happened";
const OTHER = "lw.test.other";
const DAY_MS = 86_400_000;
const NOW = Date.UTC(2026, 10, 14, 12);

let clickhouse: ClickHouseQueryClient;
let driver: QueryDriver;
let repository: EventingClickHouseEventRepository;
/** The settings of the last statement the reader identity sent; undefined when the system sent. */
let readerSent: Record<string, unknown> | undefined;
let builtSent: Record<string, unknown> | undefined;
const TENANT_SETTING = "SQL_langwatch_tenant_ids";

/** The reader identity over the same server, recording what each statement carried. */
function asReader(inner: QueryDriver): QueryDriver {
  return {
    execute<Row>(request: QueryRequest) {
      readerSent = { ...request.settings };
      return inner.execute<Row>(request);
    },
    insert: (request) => inner.insert(request),
    command: (request) => inner.command(request),
    async *stream<Row>(request: QueryRequest) {
      readerSent = { ...request.settings };
      yield* inner.stream?.<Row>(request) ?? [];
    },
  };
}

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
  const rowsOf = async <Row>(request: QueryRequest): Promise<Row[]> =>
    (await send(request, `${request.sql}\nFORMAT JSONEachRow`))
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as Row);
  return {
    async execute<Row>(request: QueryRequest) {
      return { rows: await rowsOf<Row>(request) };
    },
    /** Two batches, so the client's batch-by-batch path runs, not its one-batch fallback. */
    async *stream<Row>(request: QueryRequest) {
      const rows = await rowsOf<Row>(request);
      const half = Math.ceil(rows.length / 2);
      yield rows.slice(0, half);
      yield rows.slice(half);
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
  page: `${SELECT} WHERE ${KEY} ${UP_TO} AND IdempotencyKey >= {afterKey:String} AND (IdempotencyKey > {afterKey:String} OR EventTimestamp > {afterTimestamp:UInt64} OR (EventTimestamp = {afterTimestamp:UInt64} AND EventId > {afterEventId:String})) ORDER BY IdempotencyKey ASC, EventTimestamp ASC, EventId ASC LIMIT {limit:UInt32}`,
  count: `SELECT COUNT(DISTINCT EventId) as count FROM event_log WHERE ${KEY} AND (EventTimestamp < {beforeTimestamp:UInt64} OR (EventTimestamp = {beforeTimestamp:UInt64} AND EventId < {beforeEventId:String})) AND EventId != {beforeEventId:String}`,
};

/** Main's raw text sent as main's member adapter sent it (eventing-members.ts before ADR-202). */
async function mainRows<Row>({
  sql,
  params,
  tenantIds,
  tenantId = A,
  acrossTenants = false,
}: {
  sql: string;
  params: Record<string, unknown>;
  tenantIds?: readonly string[];
  tenantId?: string;
  /** Main's `SKIP_TENANT_CHECK` reads: the explorer's and replay's. */
  acrossTenants?: boolean;
}): Promise<Row[]> {
  const sent = {
    tenantId,
    sql,
    params,
    SKIP_COLD_SCAN_CHECK: true as const,
    ...(acrossTenants ? { SKIP_TENANT_CHECK: true as const } : {}),
  };
  return (await clickhouse.query<Row>(tenantIds === undefined ? sent : { ...sent, tenantIds }))
    .rows;
}

/** A built read sent as the port sends it. */
async function builtRows(built: Parameters<ClickHouseQueryClient["read"]>[0]): Promise<unknown[]> {
  readerSent = undefined;
  const { rows } = await clickhouse.read(built);
  builtSent = readerSent;
  return rows;
}

/** The built read left as the reader with exactly this tenant setting, or as the system. */
function expectSentAs(tenantId: string | undefined): void {
  const SYSTEM = "the system identity";
  expect(builtSent === undefined ? SYSTEM : builtSent[TENANT_SETTING]).toBe(tenantId ?? SYSTEM);
}

/** Events e0..e5 of one aggregate; the first has no occurred time, one is a month old. */
function events(tenantId: string, aggregateId: string, offset = 0) {
  return [0, 1, 2, 3, 4, 5].map((index) => ({
    TenantId: tenantId,
    IdempotencyKey: `${aggregateId}-e${index}`,
    AggregateType: TYPE,
    AggregateId: aggregateId,
    EventId: `e${index}`,
    EventType: index % 3 === 2 ? OTHER : HAPPENED,
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
    readerDriver: asReader(driver),
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

    const afterKey = `${key.aggregateId}-e1`;
    const page = { after: { idempotencyKey: afterKey, timestamp: 2_000, eventId: "e1" }, limit: 2 };
    const builtPage = await repository.getEventRecordsUpToPaged({ ...upTo, ...page });
    const mainPage = await mainRows<Row>({
      sql: MAIN.page,
      params: { ...upTo, afterKey, afterTimestamp: 2_000, afterEventId: "e1", limit: 2 },
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

/** Rows whose order main left to the server (GROUP BY without a full ORDER BY), in one order. */
const sorted = <Row>(rows: readonly Row[]): Row[] =>
  [...rows]
    .map((row) => JSON.stringify(row, Object.keys(row as object).toSorted()))
    .toSorted()
    .map((text) => JSON.parse(text) as Row);

/** Each row's group array in one order: `groupUniqArray` gives none. */
const uniqSorted = (rows: readonly unknown[]): unknown[] =>
  (rows as { eventTypes: string[] }[]).map((row) => ({
    ...row,
    eventTypes: row.eventTypes.toSorted(),
  }));

/** 64-bit integers as numbers: the server quotes them or not by its JSON output setting. */
const unquoted = (rows: readonly unknown[]): unknown[] =>
  rows.map((row) =>
    Object.fromEntries(
      Object.entries(row as object).map(([name, value]) => [
        name,
        typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value,
      ]),
    ),
  );

const WEEK_AGO = NOW - 7 * DAY_MS;
const WINDOW = { minMs: NOW - 2 * DAY_MS, maxMs: NOW };
const PRUNING =
  "AND (EventOccurredAt = 0 OR (EventOccurredAt >= {minOccurredAtMs:UInt64} AND EventOccurredAt <= {maxOccurredAtMs:UInt64}))";
const pruningParams = (bounds: typeof WINDOW | undefined) =>
  bounds === undefined ? {} : { minOccurredAtMs: bounds.minMs, maxOccurredAtMs: bounds.maxMs };
const REPLAY_COLUMNS =
  "EventId, EventTimestamp, EventOccurredAt, EventType, EventPayload, EventVersion, TenantId, AggregateType, AggregateId, ProcessingTraceparent, IdempotencyKey";
const UP_TO_CUTOFF =
  "AND (EventTimestamp < {maxCutoffTimestamp:UInt64} OR (EventTimestamp = {maxCutoffTimestamp:UInt64} AND EventId <= {maxCutoffEventId:String}))";
const AFTER_CURSOR =
  "AND (EventTimestamp > {cursorTimestamp:UInt64} OR (EventTimestamp = {cursorTimestamp:UInt64} AND EventId > {cursorEventId:String}))";
const BATCH =
  "TenantId = {tenantId:String} AND EventType IN ({eventTypes:Array(String)}) AND AggregateId IN ({aggregateIds:Array(String)})";
const when = (on: boolean, text: string): string => (on ? text : "");

/** Main's explorer and replay text (the two adapters at 6598bd032d^): the oracle. */
const MAIN_OPS = {
  discovery: (filtered: boolean) =>
    `SELECT AggregateType AS aggregateType, TenantId AS tenantId, count(DISTINCT AggregateId) AS aggregateCount FROM event_log WHERE AggregateType IN ({aggregateTypes:Array(String)}) AND (EventOccurredAt = 0 OR EventOccurredAt >= {sinceMs:UInt64}) ${when(filtered, "AND TenantId IN ({tenantIds:Array(String)})")} GROUP BY AggregateType, TenantId ORDER BY AggregateType, TenantId`,
  search: ({ since, tenants, pattern }: { since: boolean; tenants: boolean; pattern: boolean }) =>
    `SELECT AggregateId AS aggregateId, AggregateType AS aggregateType, TenantId AS tenantId, count() AS eventCount, max(EventTimestamp) AS lastEventTime FROM event_log WHERE 1=1 ${when(since, "AND (EventOccurredAt = 0 OR EventOccurredAt >= {sinceMs:UInt64})")} ${when(tenants, "AND TenantId IN ({tenantIds:Array(String)})")} ${when(pattern, "AND (AggregateId LIKE {queryPattern:String} OR TenantId LIKE {queryPattern:String})")} GROUP BY AggregateId, AggregateType, TenantId ORDER BY lastEventTime DESC LIMIT 50`,
  history:
    "SELECT EventId AS eventId, EventType AS eventType, EventTimestamp AS eventTimestamp, EventPayload AS payload FROM event_log WHERE TenantId = {tenantId:String} AND AggregateId = {aggregateId:String} ORDER BY EventTimestamp ASC, EventId ASC LIMIT {limit:UInt32}",
  discover: (tenant: boolean) =>
    `SELECT TenantId AS tenantId, AggregateType AS aggregateType, AggregateId AS aggregateId, groupUniqArray(EventType) AS eventTypes FROM event_log WHERE EventType IN ({eventTypes:Array(String)}) AND EventTimestamp >= {sinceMs:UInt64} ${when(tenant, "AND TenantId = {tenantId:String}")} GROUP BY TenantId, AggregateType, AggregateId ORDER BY TenantId`,
  tenants:
    "SELECT DISTINCT TenantId AS tenantId FROM event_log WHERE EventType IN ({eventTypes:Array(String)}) AND EventTimestamp >= {sinceMs:UInt64} ORDER BY TenantId",
  count: (tenant: boolean) => {
    const own = when(tenant, "TenantId = {tenantId:String} AND");
    return `SELECT count() as totalEvents FROM event_log WHERE ${own} EventType IN ({eventTypes:Array(String)}) AND (AggregateType, AggregateId) IN (SELECT DISTINCT AggregateType, AggregateId FROM event_log WHERE ${own} EventType IN ({eventTypes:Array(String)}) AND EventTimestamp >= {sinceMs:UInt64})`;
  },
  bounds:
    "SELECT count() AS cnt, min(EventOccurredAt) AS minOccurredAt, max(EventOccurredAt) AS maxOccurredAt FROM event_log WHERE TenantId = {tenantId:String} AND AggregateType IN ({aggregateTypes:Array(String)}) AND AggregateId IN ({aggregateIds:Array(String)})",
  cutoffs: (pruned: boolean) =>
    `SELECT AggregateType AS aggregateType, AggregateId AS aggregateId, argMax(EventId, (EventTimestamp, EventId)) AS cutoffEventId, max(EventTimestamp) AS cutoffTimestamp FROM event_log WHERE ${BATCH} ${when(pruned, PRUNING)} GROUP BY AggregateType, AggregateId`,
  load: ({ cursor, pruned }: { cursor: boolean; pruned: boolean }) =>
    `SELECT ${REPLAY_COLUMNS} FROM event_log WHERE ${BATCH} ${UP_TO_CUTOFF} ${when(cursor, AFTER_CURSOR)} ${when(pruned, PRUNING)} ORDER BY EventTimestamp ASC, EventId ASC LIMIT {batchSize:UInt32}`,
  stream: (pruned: boolean) =>
    `SELECT ${REPLAY_COLUMNS} FROM event_log WHERE ${BATCH} ${when(pruned, PRUNING)} ORDER BY AggregateId, EventTimestamp ASC, EventId ASC`,
};

describe("the explorer's built reads on ClickHouse 26.8", () => {
  it.each([undefined, [A, C]])(
    "discovers aggregates per tenant as main does, tenants %s",
    async (tenantIds) => {
      const built = await builtRows(
        aggregateDiscoveryRead({ aggregateTypes: [TYPE], sinceMs: WEEK_AGO, tenantIds }),
      );
      const main = await mainRows({
        sql: MAIN_OPS.discovery(tenantIds !== undefined),
        params: { aggregateTypes: [TYPE], sinceMs: WEEK_AGO, ...(tenantIds ? { tenantIds } : {}) },
        tenantId: "",
        acrossTenants: true,
      });

      expect(built).toEqual(main);
      expect(built).toHaveLength(tenantIds === undefined ? 3 : 2);
      expectSentAs(undefined);
    },
  );

  it.each([
    { queryPattern: "%agg-1%", tenantIds: undefined, sinceMs: WEEK_AGO },
    { queryPattern: undefined, tenantIds: [B], sinceMs: undefined },
  ])("searches aggregates as main does, %o", async ({ queryPattern, tenantIds, sinceMs }) => {
    const built = await builtRows(aggregateSearchRead({ queryPattern, tenantIds, sinceMs }));
    const main = await mainRows({
      sql: MAIN_OPS.search({
        since: sinceMs !== undefined,
        tenants: tenantIds !== undefined,
        pattern: queryPattern !== undefined,
      }),
      params: {
        ...(sinceMs === undefined ? {} : { sinceMs }),
        ...(tenantIds === undefined ? {} : { tenantIds }),
        ...(queryPattern === undefined ? {} : { queryPattern }),
      },
      tenantId: "",
      acrossTenants: true,
    });

    // Two aggregates of one tenant share their last event time, so their order is the server's.
    expect(sorted(built)).toEqual(sorted(main));
    expect(built).toHaveLength(queryPattern === undefined ? 2 : 3);
    expectSentAs(undefined);
  });

  it("reads one aggregate's history as main does, only on its own tenant", async () => {
    const params = { tenantId: B, aggregateId: "agg-2", limit: 4 };
    const built = (await builtRows(aggregateHistoryRead(params))) as { payload: string }[];
    expectSentAs(B);
    const main = await mainRows({ sql: MAIN_OPS.history, params, tenantId: B });

    expect(built).toEqual(main);
    expect(built.map((row) => (JSON.parse(row.payload) as { tenantId: string }).tenantId)).toEqual([
      B,
      B,
      B,
      B,
    ]);
  });
});

describe("replay's built reads on ClickHouse 26.8", () => {
  it.each([undefined, A])(
    "discovers affected aggregates as main does, tenant %s",
    async (tenantId) => {
      const input = { eventTypes: [OTHER], sinceMs: 3_000 };
      const built = await builtRows(affectedAggregatesRead({ ...input, tenantId }));
      const main = await mainRows({
        sql: MAIN_OPS.discover(tenantId !== undefined),
        params: { ...input, ...(tenantId ? { tenantId } : {}) },
        tenantId: tenantId ?? REPLAY_ALL_TENANTS,
        acrossTenants: true,
      });

      expect(sorted(uniqSorted(built))).toEqual(sorted(uniqSorted(main)));
      expect(built).toHaveLength(tenantId === undefined ? 6 : 2);
      expectSentAs(tenantId);
    },
  );

  it("lists the tenants holding the event types as main does", async () => {
    const input = { eventTypes: [OTHER], sinceMs: 6_300 };
    const built = await builtRows(replayTenantsRead(input));
    const main = await mainRows({
      sql: MAIN_OPS.tenants,
      params: input,
      tenantId: REPLAY_ALL_TENANTS,
      acrossTenants: true,
    });

    expect(built).toEqual(main);
    expect(built).toEqual([{ tenantId: B }]);
    expectSentAs(undefined);
  });

  it.each([
    { tenantId: undefined, sinceMs: 5_200, total: 24 },
    { tenantId: A, sinceMs: 4_500, total: 8 },
  ])(
    "counts the events of the discovered aggregates as main does, %o",
    async ({ tenantId, sinceMs, total }) => {
      const input = { eventTypes: [HAPPENED], sinceMs };
      const built = await builtRows(discoveredEventCountRead({ ...input, tenantId }));
      const main = await mainRows({
        sql: MAIN_OPS.count(tenantId !== undefined),
        params: { ...input, ...(tenantId ? { tenantId } : {}) },
        tenantId: tenantId ?? REPLAY_ALL_TENANTS,
        acrossTenants: true,
      });

      expect(built).toEqual(main);
      expect(unquoted(built)).toEqual([{ totalEvents: total }]);
      expectSentAs(tenantId);
    },
  );

  it("reads a batch's occurred-at bounds as main does", async () => {
    const params = { tenantId: A, aggregateTypes: [TYPE], aggregateIds: ["agg-1"] };
    const built = await builtRows(occurredAtBoundsRead(params));
    expectSentAs(A);
    const main = await mainRows({ sql: MAIN_OPS.bounds, params });

    expect(built).toEqual(main);
    expect(unquoted(built)).toEqual([{ cnt: 6, minOccurredAt: 0, maxOccurredAt: NOW - DAY_MS }]);
  });

  it.each([undefined, WINDOW])(
    "reads each aggregate's cutoff as main does, bounds %o",
    async (bounds) => {
      const input = { tenantId: A, aggregateIds: ["agg-1", "agg-2"], eventTypes: [HAPPENED] };
      const built = await builtRows(cutoffEventsRead({ ...input, occurredAtBounds: bounds }));
      const main = await mainRows({
        sql: MAIN_OPS.cutoffs(bounds !== undefined),
        params: { ...input, ...pruningParams(bounds) },
      });

      expect(sorted(built)).toEqual(sorted(main));
      expectSentAs(A);
      expect(unquoted(sorted(built))).toEqual(
        ["agg-1", "agg-2"].map((aggregateId) => ({
          aggregateId,
          aggregateType: TYPE,
          cutoffEventId: "e4",
          cutoffTimestamp: 5_000,
        })),
      );
    },
  );

  it.each([
    { cursor: undefined, bounds: undefined, batchSize: 10, ids: ["e0", "e1", "e2", "e3", "e4"] },
    {
      cursor: { timestamp: 2_000, eventId: "e1" },
      bounds: WINDOW,
      batchSize: 2,
      ids: ["e2", "e3"],
    },
  ])(
    "loads a page of a batch's events as main does, %o",
    async ({ cursor, bounds, batchSize, ids }) => {
      const input = { tenantId: A, aggregateIds: ["agg-1"], eventTypes: [HAPPENED, OTHER] };
      const maxCutoff = { timestamp: 5_000, eventId: "e4" };
      const built = (await builtRows(
        aggregateEventsPageRead({
          ...input,
          maxCutoff,
          cursor,
          batchSize,
          occurredAtBounds: bounds,
        }),
      )) as { EventId: string }[];
      const main = await mainRows({
        sql: MAIN_OPS.load({ cursor: cursor !== undefined, pruned: bounds !== undefined }),
        params: {
          ...input,
          maxCutoffTimestamp: maxCutoff.timestamp,
          maxCutoffEventId: maxCutoff.eventId,
          ...(cursor ? { cursorTimestamp: cursor.timestamp, cursorEventId: cursor.eventId } : {}),
          batchSize,
          ...pruningParams(bounds),
        },
      });

      expect(built).toEqual(main);
      expect(built.map((row) => row.EventId)).toEqual(ids);
      expectSentAs(A);
    },
  );

  it.each([undefined, WINDOW])(
    "streams a batch's events in replay order as main's text reads them, bounds %o",
    async (bounds) => {
      const input = { tenantId: A, aggregateIds: ["agg-1", "agg-2"], eventTypes: [HAPPENED] };
      const batches: unknown[][] = [];
      readerSent = undefined;
      for await (const batch of clickhouse.stream(
        streamedEventsRead({ ...input, occurredAtBounds: bounds }),
      )) {
        batches.push(batch);
      }
      builtSent = readerSent;
      expectSentAs(A);
      const main = await mainRows({
        sql: MAIN_OPS.stream(bounds !== undefined),
        params: { ...input, ...pruningParams(bounds) },
      });

      expect(batches).toHaveLength(2);
      expect(batches.flat()).toEqual(main);
      expect(main).toHaveLength(bounds === undefined ? 8 : 6);
    },
  );
});

describe("the storage meter's event-log read on ClickHouse 26.8", () => {
  /** @scenario "The event log's stored bytes count only this tenant's rows" */
  it("sums this tenant's `_size_bytes` as main's raw read does, without the other tenants'", async () => {
    const retention = EventLogRetention.create({
      client: {
        command: async () => undefined,
        query: async () => ({ rows: [] }),
        read: (input) => {
          readerSent = undefined;
          return clickhouse.read(input).finally(() => {
            builtSent = readerSent;
          });
        },
      },
      classification: {
        categories: [],
        classByAggregateType: {},
        indefiniteClass: "indefinite",
        indefiniteEventTypePrefixes: [],
        indefiniteEventTypes: [],
      },
    });
    const rawBytes = async (tenantId: string) =>
      Number(
        (
          await mainRows<{ bytes: string }>({
            sql: "SELECT sum(_size_bytes) AS bytes FROM event_log WHERE TenantId = {tenantId:String}",
            params: { tenantId },
            tenantId,
          })
        )[0]?.bytes ?? 0,
      );

    const bytes = await retention.getStoredBytes({
      tenantId: A,
      settings: { max_threads: 2, max_execution_time: 45 },
    });

    expectSentAs(A);
    expect(bytes).toBeGreaterThan(0);
    expect(bytes).toBe(await rawBytes(A));
    expect(await rawBytes(B)).toBeGreaterThan(0);
  });
});
