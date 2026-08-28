/**
 * @vitest-environment node
 * @integration
 *
 * Verifies the bloom_filter skip-index on coding_agent_sessions.SessionId
 * (migration 00087).
 *
 * coding_agent_sessions is ORDER BY (TenantId, StartedAt, SessionId), which
 * leads with time. The single-session read's dedup subquery must stay
 * unwindowed for correctness (ADR-071), and with StartedAt unconstrained the
 * primary index cannot exclude a granule on SessionId. The bloom filter is what
 * makes that read cheap; the sort key cannot.
 *
 * These assert on rows actually read rather than on `SHOW CREATE TABLE`. DDL
 * only proves an index is attached, which stays true of an index that prunes
 * nothing, and that is exactly the state migrations 00062 and 00063 left their
 * indexes in for a month (see #5864).
 *
 * NOT covered here: that the migration's `MATERIALIZE INDEX` backfilled the
 * parts that predate it. Rows inserted by this suite are written after the
 * index exists, so they are born indexed and would pass either way. Reproducing
 * the production case needs parts in Wide format, since a small Compact part
 * picks the index up on ADD alone, and that needs a fixture heavy enough to
 * cross the wide-part threshold. The justification for materialising inline is
 * the production EXPLAIN evidence in migration 00087's comment, not this suite.
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  startTestContainers,
  stopTestContainers,
} from "../../../../event-sourcing/__tests__/integration/testContainers";

let ch: ClickHouseClient;
const tag = `t${nanoid(8)}`;

/**
 * Session ids are FIXED, not derived from `tag`, while tenant ids stay unique.
 *
 * A bloom filter can report a value as possibly-present when it is absent. With
 * ids that changed every run, "reads zero rows" would roll a fresh false-positive
 * chance each time and fail rarely and unreproducibly. Fixed values make the
 * outcome the same on every run: if these three ever collide in the filter the
 * suite fails consistently and is fixed by changing them, which is a far better
 * failure than an occasional red build.
 *
 * BRACKET_LOW and BRACKET_HIGH sort either side of ABSENT_SESSION, and are
 * written into the SAME weekly partition on purpose. SessionId is the last
 * sort-key column and the primary key prunes on a granule's min/max, so only
 * when both bracketing ids share a granule does its range span ABSENT_SESSION
 * and leave the granule eligible. Split across partitions, each granule holds
 * one session, its SessionId range is a single point, ABSENT_SESSION falls
 * outside it, and the primary key alone excludes it: the assertion would then
 * hold with no skip index at all. FAR_SESSION sits in another partition so the
 * read still spans more than one.
 */
const TENANTS = ["a", "b", "c", "d"] as const;
const tenantIdFor = (suffix: (typeof TENANTS)[number]) =>
  `${tag}-tenant-${suffix}`;

const BRACKET_LOW = "aaaa-session-low";
const ABSENT_SESSION = "mmmm-session-absent";
const BRACKET_HIGH = "zzzz-session-high";
const FAR_SESSION = "ffff-session-far";

/** One week apart at most, so the bracketing pair shares a partition. */
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

/** One call, one part. Which rows share a part decides what the primary key can prune. */
async function insertSessions({ sessions }: { sessions: SessionFixture[] }) {
  await ch.insert({
    table: "coding_agent_sessions",
    values: sessions.map((session) => ({
      TenantId: session.tenantId,
      SessionId: session.sessionId,
      SessionKeySource: "session_id",
      Version: "v1",
      StartedAt: session.startedAt,
      CreatedAt: session.startedAt,
      UpdatedAt: session.updatedAt,
      Agent: "claude_code",
      ModelCalls: session.modelCalls ?? 0,
    })),
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
}

/**
 * Rows ClickHouse had to read to answer the query. Zero means every granule was
 * skipped, which is only possible when a skip index excluded them: the
 * time-leading primary key cannot, and a granule that is read still counts here
 * even though the row is filtered out afterwards.
 */
async function rowsReadForSessionLookup({
  tenantId,
  sessionId,
  useSkipIndexes = true,
}: {
  tenantId: string;
  sessionId: string;
  useSkipIndexes?: boolean;
}): Promise<number> {
  const result = await ch.query({
    query: `
      SELECT TenantId, SessionId, max(UpdatedAt) AS UpdatedAt
      FROM coding_agent_sessions
      WHERE TenantId = {tenantId:String} AND SessionId = {sessionId:String}
      GROUP BY TenantId, SessionId
    `,
    query_params: { tenantId, sessionId },
    clickhouse_settings: { use_skip_indexes: useSkipIndexes ? 1 : 0 },
    format: "JSON",
  });
  const body = (await result.json()) as {
    statistics?: { rows_read?: number };
  };
  return body.statistics?.rows_read ?? -1;
}

/** The latest-version read the repository performs, reduced to its essentials. */
async function latestVersion({
  tenantId,
  sessionId,
}: {
  tenantId: string;
  sessionId: string;
}) {
  const rows = await (
    await ch.query({
      query: `
        SELECT SessionId, ModelCalls
        FROM coding_agent_sessions
        WHERE TenantId = {tenantId:String}
          AND SessionId = {sessionId:String}
          AND (TenantId, SessionId, UpdatedAt) IN (
            SELECT TenantId, SessionId, max(UpdatedAt)
            FROM coding_agent_sessions
            WHERE TenantId = {tenantId:String} AND SessionId = {sessionId:String}
            GROUP BY TenantId, SessionId
          )
        ORDER BY ModelCalls DESC, StartedAt ASC
        LIMIT 1
      `,
      query_params: { tenantId, sessionId },
      format: "JSONEachRow",
    })
  ).json<{ SessionId: string; ModelCalls: number }>();
  return rows[0] ?? null;
}

beforeAll(async () => {
  const containers = await startTestContainers();
  ch = containers.clickHouseClient;
}, 60_000);

afterAll(async () => {
  if (ch) {
    // Delete each tenant this suite created by exact id. A prefix match could
    // reach a tenant belonging to another suite that happened to share it.
    for (const suffix of TENANTS) {
      await ch.exec({
        query: `ALTER TABLE coding_agent_sessions DELETE WHERE TenantId = {tenantId:String}`,
        query_params: { tenantId: tenantIdFor(suffix) },
      });
    }
  }
  await stopTestContainers();
});

describe("given the coding_agent_sessions SessionId skip-index", () => {
  it("attaches a bloom_filter index on SessionId", async () => {
    const ddl = await (
      await ch.query({
        query: "SHOW CREATE TABLE coding_agent_sessions",
        format: "TabSeparatedRaw",
      })
    ).text();
    expect(ddl).toMatch(/INDEX\s+idx_session_id\b/i);
    expect(ddl).toMatch(/idx_session_id[\s\S]*TYPE\s+bloom_filter/i);
  });

  describe("when looking up a session that does not exist", () => {
    it("reads no rows at all", async () => {
      const tenantId = tenantIdFor("a");
      // Sessions spread across partitions, so a time-unbounded lookup would
      // otherwise have a candidate granule in each one.
      //
      // ONE insert, so both bracketing ids land in a single part and therefore a
      // single granule whose SessionId range spans ABSENT_SESSION. Two inserts
      // would make two parts, each with a single-point range that the primary
      // key could exclude on its own.
      await insertSessions({
        sessions: [
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
        sessions: [
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
      // makes the assertion below about the bloom filter and nothing else.
      expect(
        await rowsReadForSessionLookup({
          tenantId,
          sessionId: ABSENT_SESSION,
          useSkipIndexes: false,
        }),
      ).toBeGreaterThan(0);

      expect(
        await rowsReadForSessionLookup({ tenantId, sessionId: ABSENT_SESSION }),
      ).toBe(0);
    });
  });

  describe("when the same lookup filters a column with no skip index", () => {
    it("reads rows, which is what the SessionId case is being measured against", async () => {
      // Control for the assertion above. UserId has no index and is not in the
      // sort key, so an absent value cannot be skipped and the rows must be
      // read and filtered. If this ever returns 0 as well, the zero above has
      // stopped meaning "the bloom filter skipped the granule".
      const tenantId = tenantIdFor("a");
      const result = await ch.query({
        query: `
          SELECT count() FROM coding_agent_sessions
          WHERE TenantId = {tenantId:String} AND UserId = {userId:String}
        `,
        query_params: { tenantId, userId: `${tag}-nobody` },
        format: "JSON",
      });
      const body = (await result.json()) as {
        statistics?: { rows_read?: number };
      };
      expect(body.statistics?.rows_read ?? 0).toBeGreaterThan(0);
    });
  });

  describe("when the session exists", () => {
    it("returns the version that folded the most, unchanged by the index", async () => {
      const tenantId = tenantIdFor("b");
      const sessionId = `${tag}-s3`;
      // Same UpdatedAt on both versions, so the tiebreak decides. The index
      // must not disturb which version wins.
      const updatedAt = new Date("2026-03-09T00:00:01.000Z");
      await insertSessions({
        sessions: [
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
        sessions: [
          {
            tenantId,
            sessionId,
            startedAt: new Date("2026-03-09T00:00:00.000Z"),
            updatedAt,
            modelCalls: 7,
          },
        ],
      });

      expect(await latestVersion({ tenantId, sessionId })).toEqual({
        SessionId: sessionId,
        ModelCalls: 7,
      });
    });
  });

  describe("when two tenants share a session id", () => {
    it("keeps the lookup scoped to the requesting tenant", async () => {
      const sessionId = `${tag}-shared`;
      await insertSessions({
        sessions: [
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
        sessions: [
          {
            tenantId: tenantIdFor("d"),
            sessionId,
            startedAt: new Date("2026-05-04T00:00:00.000Z"),
            updatedAt: new Date("2026-05-04T00:00:01.000Z"),
            modelCalls: 9,
          },
        ],
      });

      expect(
        await latestVersion({ tenantId: tenantIdFor("c"), sessionId }),
      ).toEqual({
        SessionId: sessionId,
        ModelCalls: 3,
      });
      expect(
        await latestVersion({ tenantId: tenantIdFor("d"), sessionId }),
      ).toEqual({
        SessionId: sessionId,
        ModelCalls: 9,
      });
    });
  });
});
