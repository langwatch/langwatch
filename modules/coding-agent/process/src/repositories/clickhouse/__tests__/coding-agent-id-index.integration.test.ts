/** @vitest-environment node */

/**
 * Coding-agent lookups by id alone against the migrated ClickHouse (goose 00117): found through
 * the index, bounded to its range, reaching fewer parts than an unbounded read.
 */
import { randomUUID } from "node:crypto";

import { type ClickHouseClient, createClient } from "@clickhouse/client";
import {
  type ClickHouseQueryClient,
  type InsertRequest,
  type QueryRequest,
  setWindowedReadMetrics,
  type WindowedReadOutcome,
} from "@langwatch/clickhouse-client";
import {
  idIndexedClientDouble,
  migrateTestClickHouseOnce,
  partsAfterPartitionPruning,
  readyIdIndexedClientDouble,
  type ScriptedStatements,
  startTestClickHouseEndpoints,
} from "@langwatch/clickhouse-client/testing";
import { ClickHouseMigrateTask } from "@langwatch/clickhouse-migrations";
import { nowInstant } from "@langwatch/time";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  session,
  sessionEventRecord,
  TestClock,
} from "../../../__tests__/fixtures/coding-agent.fixture.ts";
import { NoopCodingAgentReadMetricsService } from "../../../__tests__/support/coding-agent-read-metrics-noop.service.ts";
import { CODING_AGENT_ID_INDEXES } from "../clickhouse.coding-agent-id-indexes.database.ts";
import { CodingAgentSessionEventsClickHouseRepository } from "../clickhouse.coding-agent-session-event.repository.ts";
import { CodingAgentSessionClickHouseRepository } from "../clickhouse.coding-agent-session.repository.ts";
import { CodingAgentTraceSessionClickHouseRepository } from "../clickhouse.coding-agent-trace-session.repository.ts";
const DAY_MS = 86_400_000;

const tenantId = `${randomUUID()}-id-index`;
const eightWeeksAgoMs = nowInstant().epochMilliseconds - 56 * DAY_MS;
// Each decoy partition holds ids on both sides of every real id, in one part, so the planner
// cannot rule that part out by key and an unbounded read must open it.
const decoyAgesInDays = [100, 200];
const decoyIds = ["!decoy", "~decoy"];

let ch: ClickHouseClient;
let statements: QueryRequest[] = [];
let outcomes: { table: string; outcome: WindowedReadOutcome }[] = [];
/** The indexes read as filled, and as not filled: the same server, with and without the bound. */
let clickhouse: ClickHouseQueryClient;
let unready: ClickHouseQueryClient;
let sessions: CodingAgentSessionClickHouseRepository;
let events: CodingAgentSessionEventsClickHouseRepository;
let traceSessions: CodingAgentTraceSessionClickHouseRepository;
/** The same repositories over the not-ready client: the read as it ran before the index. */
let unbounded: {
  sessions: CodingAgentSessionClickHouseRepository;
  events: CodingAgentSessionEventsClickHouseRepository;
  traceSessions: CodingAgentTraceSessionClickHouseRepository;
};

/** A recording driver, so the test can run the exact source statement through the planner. */
function recordingDriver(client: ClickHouseClient): ScriptedStatements {
  return {
    async execute(request: QueryRequest) {
      statements.push(request);
      const result = await client.query({
        query: request.sql,
        format: "JSONEachRow",
        ...(request.params === undefined ? {} : { query_params: request.params }),
        ...(request.settings === undefined ? {} : { clickhouse_settings: request.settings }),
      });
      return { rows: await result.json() };
    },
    async insert(request: InsertRequest) {
      await client.insert({
        table: request.table,
        values: request.rows,
        format: "JSONEachRow",
        ...(request.settings === undefined ? {} : { clickhouse_settings: request.settings }),
      });
    },
  };
}

/** The parts the planner reaches for one statement, summed over the tables it names. */
async function partsReached(request: QueryRequest): Promise<number> {
  const result = await ch.query({
    query: `EXPLAIN ESTIMATE ${request.sql}`,
    format: "JSONEachRow",
    ...(request.params === undefined ? {} : { query_params: request.params }),
  });
  const rows = await result.json<{ parts: number | string }>();
  return rows.reduce((total, row) => total + Number(row.parts), 0);
}

/** One query on the test server, its rows as JSONEachRow parses them. */
async function queryRows(query: string, params?: Record<string, unknown>): Promise<unknown[]> {
  const result = await ch.query({
    query,
    format: "JSONEachRow",
    ...(params === undefined ? {} : { query_params: params }),
  });
  return result.json();
}

/** The one statement that read `table`'s source rows, not its index. */
function sourceReadOf(table: string): QueryRequest {
  const read = statements.find(
    (request) => request.sql.includes(`FROM ${table}`) && !request.sql.includes("_id_index"),
  );
  if (!read) throw new Error(`no source read of ${table} was sent`);
  return read;
}

beforeAll(async () => {
  const [endpoint] = await startTestClickHouseEndpoints({
    suite: "coding-agent-id-index",
    names: ["schema"],
    environment: process.env,
  });
  if (!endpoint) throw new Error("No ClickHouse endpoint was provisioned for the id-index suite");
  await migrateTestClickHouseOnce({
    url: endpoint.url,
    migrate: async () => {
      // CLICKHOUSE_CLUSTER switches every engine to its Replicated form, which needs a Keeper.
      const previousCluster = process.env.CLICKHOUSE_CLUSTER;
      delete process.env.CLICKHOUSE_CLUSTER;
      try {
        await ClickHouseMigrateTask.createFromConfig({
          config: { buildTime: false, sharedUrl: endpoint.url, privateEndpoints: [] },
        }).execute();
      } finally {
        if (previousCluster !== undefined) process.env.CLICKHOUSE_CLUSTER = previousCluster;
      }
    },
  });
  ch = createClient({
    url: endpoint.url,
    clickhouse_settings: { date_time_input_format: "best_effort" },
  });
  clickhouse = await readyIdIndexedClientDouble({
    indexes: CODING_AGENT_ID_INDEXES,
    driver: recordingDriver(ch),
  });
  unready = idIndexedClientDouble({
    indexes: CODING_AGENT_ID_INDEXES,
    driver: recordingDriver(ch),
  });
  sessions = CodingAgentSessionClickHouseRepository.create({
    clickhouse,
    defaultTraceRetentionDays: 308,
    metrics: NoopCodingAgentReadMetricsService.create(),
    clock: new TestClock(),
  });
  events = CodingAgentSessionEventsClickHouseRepository.create({
    clickhouse,
    defaultTraceRetentionDays: 308,
  });
  traceSessions = CodingAgentTraceSessionClickHouseRepository.create({
    clickhouse,
    defaultTraceRetentionDays: 308,
  });
  unbounded = {
    sessions: CodingAgentSessionClickHouseRepository.create({
      clickhouse: unready,
      defaultTraceRetentionDays: 308,
      metrics: NoopCodingAgentReadMetricsService.create(),
      clock: new TestClock(),
    }),
    events: CodingAgentSessionEventsClickHouseRepository.create({
      clickhouse: unready,
      defaultTraceRetentionDays: 308,
    }),
    traceSessions: CodingAgentTraceSessionClickHouseRepository.create({
      clickhouse: unready,
      defaultTraceRetentionDays: 308,
    }),
  };
  setWindowedReadMetrics({ record: (entry) => outcomes.push(entry) });

  const sessionId = `${tenantId}-session`;
  const traceId = `${tenantId}-trace`;
  const target = { id: sessionId, traceId, startedAtMs: eightWeeksAgoMs };
  const decoys = decoyAgesInDays.flatMap((days) =>
    decoyIds.map((id) => ({
      id: `${id}-${days}`,
      traceId: `${id}-${days}`,
      startedAtMs: Date.now() - days * DAY_MS,
    })),
  );
  for (const group of [
    [target],
    ...decoyAgesInDays.map((days) => decoys.filter((each) => each.id.endsWith(`-${days}`))),
  ]) {
    await sessions.upsertBatch(
      group.map(({ id, startedAtMs }) => ({
        row: session({ tenantId, sessionId: id, startedAtMs, updatedAt: startedAtMs }),
        retentionDays: 308,
        appliedEventIds: [],
      })),
    );
    await events.ensure(
      group.map(({ id, startedAtMs }) =>
        sessionEventRecord({
          tenantId,
          sessionId: id,
          timeUnixMs: startedAtMs,
          recordId: `${id}-e`,
        }),
      ),
      308,
    );
    await traceSessions.ensure(
      group.map(({ id, traceId: groupTraceId, startedAtMs }) => ({
        tenantId,
        traceId: groupTraceId,
        sessionId: id,
        occurredAtMs: startedAtMs,
      })),
      308,
    );
  }
}, 120_000);

beforeEach(() => {
  statements = [];
  outcomes = [];
});

afterAll(async () => {
  if (!ch) return;
  for (const table of [
    "coding_agent_sessions",
    "coding_agent_session_events",
    "coding_agent_trace_sessions",
  ]) {
    for (const name of [table, `${table}_id_index`]) {
      await ch.exec({
        query: `ALTER TABLE ${name} DELETE WHERE TenantId = {tenantId:String}`,
        query_params: { tenantId },
      });
    }
  }
  await ch.close();
});

describe("coding-agent lookups by id with the id index", () => {
  describe("given a session written eight weeks ago", () => {
    /** @scenario "a lookup by id reads only the partitions the index names" */
    it("finds it by session id alone and reads fewer parts than the unbounded read", async () => {
      const sessionId = `${tenantId}-session`;

      const found = await sessions.findBySessionId({ tenantId, sessionId });

      expect(found?.sessionId).toBe(sessionId);
      expect(outcomes).toContainEqual({ table: "coding_agent_sessions", outcome: "index_hit" });
      const bounded = sourceReadOf("coding_agent_sessions");
      expect(bounded.params).toMatchObject({
        idBound_fromMs: eightWeeksAgoMs - DAY_MS,
        idBound_toMs: eightWeeksAgoMs + DAY_MS,
      });
      statements = [];
      await unbounded.sessions.findBySessionId({ tenantId, sessionId });
      expect(await partsReached(bounded)).toBeLessThan(
        await partsReached(sourceReadOf("coding_agent_sessions")),
      );
    });

    /** @scenario "a lookup by id reads only the partitions the index names" */
    it("lists its events by session id alone inside the index's range", async () => {
      const sessionId = `${tenantId}-session`;

      const page = await events.listBySessionId({ tenantId, sessionId, limit: 10 });

      expect(page.events).toHaveLength(1);
      expect(outcomes).toContainEqual({
        table: "coding_agent_session_events",
        outcome: "index_hit",
      });
      const bounded = sourceReadOf("coding_agent_session_events");
      expect(bounded.params).toMatchObject({
        idBound_fromMs: eightWeeksAgoMs - DAY_MS,
        idBound_toMs: eightWeeksAgoMs + DAY_MS,
      });
      statements = [];
      await unbounded.events.listBySessionId({ tenantId, sessionId, limit: 10 });
      expect(await partsAfterPartitionPruning({ query: queryRows, request: bounded })).toBeLessThan(
        await partsAfterPartitionPruning({
          query: queryRows,
          request: sourceReadOf("coding_agent_session_events"),
        }),
      );
    });

    /** @scenario "a lookup by id reads only the partitions the index names" */
    it("finds its trace mapping by trace id alone inside the index's range", async () => {
      const traceId = `${tenantId}-trace`;

      const mapping = await traceSessions.findByTraceId({ tenantId, traceId });

      expect(mapping?.traceId).toBe(traceId);
      expect(outcomes).toContainEqual({
        table: "coding_agent_trace_sessions",
        outcome: "index_hit",
      });
      const bounded = sourceReadOf("coding_agent_trace_sessions");
      expect(bounded.params).toMatchObject({
        idBound_fromMs: eightWeeksAgoMs - DAY_MS,
        idBound_toMs: eightWeeksAgoMs + DAY_MS,
      });
      statements = [];
      await unbounded.traceSessions.findByTraceId({ tenantId, traceId });
      expect(await partsReached(bounded)).toBeLessThan(
        await partsReached(sourceReadOf("coding_agent_trace_sessions")),
      );
    });
  });
});
