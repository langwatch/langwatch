/**
 * @vitest-environment node
 * @integration
 * The coding_agent_sessions SessionId skip index (migration 00110), measured as rows read by
 * the repository's own lookup. The suite cannot cover the inline backfill of older parts.
 * @see specs/coding-agent/session-lookup-pruning.feature
 */
import { randomUUID } from "node:crypto";

import type { ClickHouseClient } from "@clickhouse/client";
import { ClickHouseQueryClient, type QueryDriver, TenantGuard } from "@langwatch/clickhouse-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { NoopCodingAgentReadMetricsService } from "../../__tests__/support/coding-agent-read-metrics-noop.service.ts";
import type { CodingAgentClock } from "../../services/coding-agent-clock.service.ts";
import {
  createTestClickHouseClient,
  testClickHouseUrl,
} from "../clickhouse/__tests__/support/clickhouse-endpoint.support.ts";
import { CodingAgentSessionClickHouseRepository } from "../clickhouse/clickhouse.coding-agent-session.repository.ts";

const clickHouseUrl = testClickHouseUrl();

class FixedClock implements CodingAgentClock {
  nowMs(): number {
    return Date.now();
  }
}

let ch: ClickHouseClient;
let sessions: CodingAgentSessionClickHouseRepository;
const tag = `t${randomUUID().slice(0, 8)}`;

/**
 * Fixed session ids, so a bloom false positive fails every run rather than one in a thousand.
 * BRACKET_LOW and BRACKET_HIGH sort either side of ABSENT_SESSION in one part of one weekly
 * partition, so the primary key cannot rule the granule out; FAR_SESSION sits in another.
 */
const TENANTS = ["a", "b", "c", "d"] as const;
const tenantIdFor = (suffix: (typeof TENANTS)[number]) => `${tag}-tenant-${suffix}`;

const BRACKET_LOW = "aaaa-session-low";
const ABSENT_SESSION = "mmmm-session-absent";
const BRACKET_HIGH = "zzzz-session-high";
const FAR_SESSION = "ffff-session-far";

/** A Monday and the Tuesday after it: the same week, so the same partition. */
const BRACKET_WEEK_A = new Date("2026-01-05T00:00:00.000Z");
const BRACKET_WEEK_B = new Date("2026-01-06T00:00:00.000Z");
/** A different partition, so the lookup spans more than one. */
const FAR_WEEK = new Date("2026-02-09T00:00:00.000Z");

interface SessionFixture {
  tenantId: string;
  sessionId: string;
  startedAt: Date;
  updatedAt: Date;
  modelCalls?: number;
}

/** One call, one part per partition it touches. */
async function insertSessions({ fixtures }: { fixtures: SessionFixture[] }) {
  await ch.insert({
    table: "coding_agent_sessions",
    values: fixtures.map((session) => ({
      TenantId: session.tenantId,
      SessionId: session.sessionId,
      SessionKeySource: "provider",
      Version: "v1",
      StartedAt: session.startedAt,
      CreatedAt: session.startedAt,
      UpdatedAt: session.updatedAt,
      Agent: "claude_code",
      ModelCalls: session.modelCalls ?? 0,
      // Fixed dates: no retention TTL, so a TTL merge cannot remove them mid-suite.
      _retention_days: 0,
    })),
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
}

interface MeasuredLookup {
  /** What the repository returned. */
  found: unknown;
  /** How many of the tagged queries system.query_log recorded as finished. */
  finishedQueries: number;
  /** Rows those queries read, the dedup subquery included. */
  rowsRead: number;
}

/** A query client over `client` that tags each read with a fresh id and sets skip indexes. */
function taggingQueryClient({
  client,
  queryIds,
  useSkipIndexes,
}: {
  client: ClickHouseClient;
  queryIds: string[];
  useSkipIndexes: boolean;
}): ClickHouseQueryClient {
  const driver: QueryDriver = {
    async execute(request) {
      const queryId = `${tag}-${randomUUID()}`;
      queryIds.push(queryId);
      const result = await client.query({
        query: request.sql,
        format: "JSONEachRow",
        query_id: queryId,
        ...(request.params === undefined ? {} : { query_params: request.params }),
        clickhouse_settings: { ...request.settings, use_skip_indexes: useSkipIndexes ? 1 : 0 },
      });
      return { rows: await result.json() };
    },
    async insert(request) {
      await client.insert({ table: request.table, values: request.rows, format: "JSONEachRow" });
    },
    async command(request) {
      await client.command({
        query: request.sql,
        ...(request.params === undefined ? {} : { query_params: request.params }),
      });
    },
  };
  return new ClickHouseQueryClient({ tenantGuard: new TenantGuard(), driver });
}

function sessionRepository(clickhouse: ClickHouseQueryClient) {
  return CodingAgentSessionClickHouseRepository.create({
    clickhouse,
    defaultTraceRetentionDays: 30,
    metrics: NoopCodingAgentReadMetricsService.create(),
    clock: new FixedClock(),
  });
}

/**
 * Runs the repository's own `findBySessionId` and reports, from system.query_log, how many
 * of its queries finished and how many rows they read. Both, because a sum over no log rows
 * is also zero: a caller asserting "read nothing" must first see the query was recorded.
 */
async function measureSessionLookup({
  tenantId,
  sessionId,
  useSkipIndexes = true,
}: {
  tenantId: string;
  sessionId: string;
  useSkipIndexes?: boolean;
}): Promise<MeasuredLookup> {
  const queryIds: string[] = [];
  const measured = sessionRepository(taggingQueryClient({ client: ch, queryIds, useSkipIndexes }));
  const found = await measured.findBySessionId({ tenantId, sessionId });

  await ch.command({ query: "SYSTEM FLUSH LOGS" });
  const result = await ch.query({
    query: `
      SELECT count() AS finished, sum(read_rows) AS rows
      FROM system.query_log
      WHERE type = 'QueryFinish' AND query_id IN {queryIds:Array(String)}
    `,
    query_params: { queryIds },
    format: "JSONEachRow",
  });
  const [row] = await result.json<{ finished: number | string; rows: number | string }>();
  return {
    found,
    finishedQueries: Number(row?.finished ?? 0),
    rowsRead: Number(row?.rows ?? 0),
  };
}

beforeAll(() => {
  if (clickHouseUrl === null) return;
  ch = createTestClickHouseClient(clickHouseUrl);
  sessions = sessionRepository(
    taggingQueryClient({ client: ch, queryIds: [], useSkipIndexes: true }),
  );
});

afterAll(async () => {
  if (clickHouseUrl === null) return;
  // Each tenant by exact id: a prefix match could reach another suite's tenant.
  for (const suffix of TENANTS) {
    await ch.command({
      query: "DELETE FROM coding_agent_sessions WHERE TenantId = {tenantId:String}",
      query_params: { tenantId: tenantIdFor(suffix) },
    });
  }
  await ch.close();
});

describe.skipIf(clickHouseUrl === null)(
  "given the coding_agent_sessions SessionId skip-index",
  () => {
    describe("when looking up a session that does not exist", () => {
      /** @scenario Looking up a session that does not exist reads nothing */
      it("reads no rows at all", async () => {
        const tenantId = tenantIdFor("a");
        // ONE insert, so both bracketing ids share a granule whose SessionId range spans
        // ABSENT_SESSION; two inserts would give two single-point ranges the primary key
        // could exclude on its own.
        await insertSessions({
          fixtures: [
            {
              tenantId,
              sessionId: BRACKET_LOW,
              startedAt: BRACKET_WEEK_A,
              updatedAt: new Date(BRACKET_WEEK_A.getTime() + 1000),
            },
            {
              tenantId,
              sessionId: BRACKET_HIGH,
              startedAt: BRACKET_WEEK_B,
              updatedAt: new Date(BRACKET_WEEK_B.getTime() + 1000),
            },
          ],
        });
        await insertSessions({
          fixtures: [
            {
              tenantId,
              sessionId: FAR_SESSION,
              startedAt: FAR_WEEK,
              updatedAt: new Date(FAR_WEEK.getTime() + 1000),
            },
          ],
        });

        // With skip indexes off, the granule is still eligible and gets read:
        // the primary key cannot exclude an id inside its range. This is what
        // makes the assertion below about the bloom filter and nothing else,
        // and it shows a non-zero count is reachable through the same
        // measurement.
        const withoutIndex = await measureSessionLookup({
          tenantId,
          sessionId: ABSENT_SESSION,
          useSkipIndexes: false,
        });
        expect(withoutIndex.found).toBeNull();
        expect(withoutIndex.finishedQueries).toBe(1);
        expect(withoutIndex.rowsRead).toBeGreaterThan(0);

        const withIndex = await measureSessionLookup({
          tenantId,
          sessionId: ABSENT_SESSION,
        });
        expect(withIndex.found).toBeNull();
        // The lookup was recorded, so the zero below is a measurement and not
        // a missing log row.
        expect(withIndex.finishedQueries).toBe(1);
        expect(withIndex.rowsRead).toBe(0);
      });
    });

    describe("when the session exists", () => {
      /** @scenario Looking up a session returns the version that folded the most */
      it("returns the version that folded the most, unchanged by the index", async () => {
        const tenantId = tenantIdFor("b");
        const sessionId = `${tag}-s3`;
        // Same UpdatedAt on both versions, so the tiebreak decides. The index
        // must not disturb which version wins.
        const updatedAt = new Date("2026-03-09T00:00:01.000Z");
        await insertSessions({
          fixtures: [
            {
              tenantId,
              sessionId,
              startedAt: new Date("2026-03-09T00:00:00.000Z"),
              updatedAt,
              modelCalls: 2,
            },
          ],
        });
        await insertSessions({
          fixtures: [
            {
              tenantId,
              sessionId,
              startedAt: new Date("2026-03-09T00:00:00.000Z"),
              updatedAt,
              modelCalls: 7,
            },
          ],
        });

        const read = await sessions.findBySessionId({ tenantId, sessionId });
        expect(read?.sessionId).toBe(sessionId);
        expect(read?.modelCalls).toBe(7);
      });
    });

    describe("when two tenants share a session id", () => {
      /** @scenario A session id used in two projects resolves within the requesting project */
      it("keeps the lookup scoped to the requesting tenant", async () => {
        const sessionId = `${tag}-shared`;
        await insertSessions({
          fixtures: [
            {
              tenantId: tenantIdFor("c"),
              sessionId,
              startedAt: new Date("2026-04-06T00:00:00.000Z"),
              updatedAt: new Date("2026-04-06T00:00:01.000Z"),
              modelCalls: 3,
            },
          ],
        });
        await insertSessions({
          fixtures: [
            {
              tenantId: tenantIdFor("d"),
              sessionId,
              startedAt: new Date("2026-05-04T00:00:00.000Z"),
              updatedAt: new Date("2026-05-04T00:00:01.000Z"),
              modelCalls: 9,
            },
          ],
        });

        const inC = await sessions.findBySessionId({
          tenantId: tenantIdFor("c"),
          sessionId,
        });
        const inD = await sessions.findBySessionId({
          tenantId: tenantIdFor("d"),
          sessionId,
        });
        expect(inC?.modelCalls).toBe(3);
        expect(inD?.modelCalls).toBe(9);
      });
    });
  },
);
