/**
 * ADR-202 on ClickHouse 26.8: the `event_log` descriptor matches goose's own text, and each built
 * read, sent through the client's built path with its tenant setting, returns exactly the rows
 * main's raw text returns. Tenant B reuses tenant A's aggregate and event ids, so a leak shows.
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

import type { EventingClickHouseClientResolver } from "../../../clickhouse-client-resolver.ts";
import {
  aggregateEventsRead,
  aggregateEventsUpToRead,
  eventCountBeforeRead,
  eventRecordRead,
  eventsOfAggregatesRead,
} from "../event-log-reads.clickhouse.ts";
import { eventLog } from "../event-log-table.clickhouse.ts";
import {
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

/** Main's raw text, as the routed member's adapter sends it (eventing-members.ts). */
const mainResolver: EventingClickHouseClientResolver = async (tenantId) => ({
  query: async (request) => ({
    json: async <Row>() =>
      (
        await clickhouse.query<Row>({
          tenantId,
          sql: request.query,
          ...(request.query_params === undefined ? {} : { params: request.query_params }),
          ...(request.SKIP_COLD_SCAN_CHECK === true ? { SKIP_COLD_SCAN_CHECK: true } : {}),
          ...(request.tenantIds === undefined ? {} : { tenantIds: request.tenantIds }),
        })
      ).rows,
  }),
  insert: async () => undefined,
});

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
    resolveClient: mainResolver,
    retention: { defaultRetentionDays: 30 },
  });
}, 120_000);

const key = { tenantId: A, aggregateType: TYPE, aggregateId: "agg-1" };
const map = (rows: Parameters<typeof mapEventLogRows>[0]["rows"]) =>
  mapEventLogRows({ rows, ...key });

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
    const main = await repository.getEventRecord({ ...key, eventId: "e3", occurredAt: window });
    const built = await clickhouse.read(eventRecordRead({ ...key, eventId: "e3", window }));

    expect(map(built.rows)).toEqual([main]);
    expect(Number(main.EventTimestamp)).toBe(4_000);
  });

  it.each([undefined, NOW - 7 * DAY_MS])(
    "reads an aggregate's events as main does, bound %s",
    async (occurredAtFromMs) => {
      const main = await repository.getEventRecords({ ...key, occurredAtFromMs });
      const built = await clickhouse.read(aggregateEventsRead({ ...key, occurredAtFromMs }));

      expect(map(built.rows)).toEqual(main);
      expect(main.map((each) => Number(each.EventTimestamp))).toEqual(
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
    const main = await repository.findEventRecordsOfAggregates({ aggregates, aggregateType: TYPE });
    const built = await clickhouse.read(
      eventsOfAggregatesRead({
        tenantIds: [A, C],
        aggregateType: TYPE,
        aggregateIds: ["agg-1", "agg-2"],
        occurredAtFromMs: undefined,
      }),
    );

    expect(
      built.rows.flatMap((row) =>
        mapEventLogRows({
          rows: [row],
          tenantId: row.TenantId,
          aggregateType: TYPE,
          aggregateId: row.AggregateId,
        }),
      ),
    ).toEqual(main);
    expect(new Set(main.map((each) => each.TenantId))).toEqual(new Set([A, C]));
    expect(main).toHaveLength(24);
  });

  it("reads up to an event, and a page after a cursor, as main does", async () => {
    const upTo = { ...key, upToTimestamp: 5_000, upToEventId: "e4", occurredAtFromMs: undefined };
    const main = await repository.getEventRecordsUpTo(upTo);
    const built = await clickhouse.read(aggregateEventsUpToRead(upTo));
    expect(map(built.rows)).toEqual(main);
    expect(main).toHaveLength(5);

    const page = { after: { timestamp: 2_000, eventId: "e1" }, limit: 2 };
    const mainPage = await repository.getEventRecordsUpToPaged({ ...upTo, ...page });
    const builtPage = await clickhouse.read(aggregateEventsUpToRead({ ...upTo, page }));
    expect(map(builtPage.rows)).toEqual(mainPage);
    expect(mainPage.map((each) => each.EventId)).toEqual(["e2", "e3"]);
  });

  it("counts the events before an event as main does", async () => {
    const before = { ...key, beforeTimestamp: 4_000, beforeEventId: "e3" };
    const main = await repository.countEventRecords(before);
    const built = await clickhouse.read(
      eventCountBeforeRead({ ...before, occurredAtFromMs: undefined }),
    );

    expect(Number(built.rows[0]?.count)).toBe(main);
    expect(main).toBe(3);
  });
});
