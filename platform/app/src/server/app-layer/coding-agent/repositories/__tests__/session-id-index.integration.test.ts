/**
 * @vitest-environment node
 * @integration
 *
 * Verifies the bloom_filter skip-index on coding_agent_sessions.SessionId
 * (migration 00085).
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
 * the production EXPLAIN evidence in migration 00085's comment, not this suite.
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

async function insertSession({
  tenantId,
  sessionId,
  startedAt,
  updatedAt,
  modelCalls = 0,
}: {
  tenantId: string;
  sessionId: string;
  startedAt: Date;
  updatedAt: Date;
  modelCalls?: number;
}) {
  await ch.insert({
    table: "coding_agent_sessions",
    values: [
      {
        TenantId: tenantId,
        SessionId: sessionId,
        SessionKeySource: "session_id",
        Version: "v1",
        StartedAt: startedAt,
        CreatedAt: startedAt,
        UpdatedAt: updatedAt,
        Agent: "claude_code",
        ModelCalls: modelCalls,
      },
    ],
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
async function rowsReadForSessionLookup(
  tenantId: string,
  sessionId: string,
): Promise<number> {
  const result = await ch.query({
    query: `
      SELECT TenantId, SessionId, max(UpdatedAt) AS UpdatedAt
      FROM coding_agent_sessions
      WHERE TenantId = {tenantId:String} AND SessionId = {sessionId:String}
      GROUP BY TenantId, SessionId
    `,
    query_params: { tenantId, sessionId },
    format: "JSON",
  });
  const body = (await result.json()) as {
    statistics?: { rows_read?: number };
  };
  return body.statistics?.rows_read ?? -1;
}

/** The latest-version read the repository performs, reduced to its essentials. */
async function latestVersion(tenantId: string, sessionId: string) {
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
    await ch.exec({
      query: `ALTER TABLE coding_agent_sessions DELETE WHERE startsWith(TenantId, {tag:String})`,
      query_params: { tag },
    });
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
      const tenantId = `${tag}-tenant-a`;
      // Sessions spread across partitions, so a time-unbounded lookup would
      // otherwise have a candidate granule in each one.
      //
      // The probed id sorts BETWEEN the two that exist, deliberately. SessionId
      // is the last sort-key column, so for an id outside the granule's key
      // range the primary index can exclude it on min/max alone and this would
      // pass with no skip index at all. Only an id inside the range forces the
      // bloom filter to be the thing that skips the granule.
      await insertSession({
        tenantId,
        sessionId: `${tag}-a-session`,
        startedAt: new Date("2026-01-05T00:00:00.000Z"),
        updatedAt: new Date("2026-01-05T00:00:01.000Z"),
      });
      await insertSession({
        tenantId,
        sessionId: `${tag}-z-session`,
        startedAt: new Date("2026-02-09T00:00:00.000Z"),
        updatedAt: new Date("2026-02-09T00:00:01.000Z"),
      });

      expect(await rowsReadForSessionLookup(tenantId, `${tag}-m-absent`)).toBe(
        0,
      );
    });
  });

  describe("when the same lookup filters a column with no skip index", () => {
    it("reads rows, which is what the SessionId case is being measured against", async () => {
      // Control for the assertion above. UserId has no index and is not in the
      // sort key, so an absent value cannot be skipped and the rows must be
      // read and filtered. If this ever returns 0 as well, the zero above has
      // stopped meaning "the bloom filter skipped the granule".
      const tenantId = `${tag}-tenant-a`;
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
      const tenantId = `${tag}-tenant-b`;
      const sessionId = `${tag}-s3`;
      // Same UpdatedAt on both versions, so the tiebreak decides. The index
      // must not disturb which version wins.
      const updatedAt = new Date("2026-03-09T00:00:01.000Z");
      await insertSession({
        tenantId,
        sessionId,
        startedAt: new Date("2026-03-09T00:00:00.000Z"),
        updatedAt,
        modelCalls: 2,
      });
      await insertSession({
        tenantId,
        sessionId,
        startedAt: new Date("2026-03-09T00:00:00.000Z"),
        updatedAt,
        modelCalls: 7,
      });

      expect(await latestVersion(tenantId, sessionId)).toEqual({
        SessionId: sessionId,
        ModelCalls: 7,
      });
    });
  });

  describe("when two tenants share a session id", () => {
    it("keeps the lookup scoped to the requesting tenant", async () => {
      const sessionId = `${tag}-shared`;
      await insertSession({
        tenantId: `${tag}-tenant-c`,
        sessionId,
        startedAt: new Date("2026-04-06T00:00:00.000Z"),
        updatedAt: new Date("2026-04-06T00:00:01.000Z"),
        modelCalls: 3,
      });
      await insertSession({
        tenantId: `${tag}-tenant-d`,
        sessionId,
        startedAt: new Date("2026-05-04T00:00:00.000Z"),
        updatedAt: new Date("2026-05-04T00:00:01.000Z"),
        modelCalls: 9,
      });

      expect(await latestVersion(`${tag}-tenant-c`, sessionId)).toEqual({
        SessionId: sessionId,
        ModelCalls: 3,
      });
      expect(await latestVersion(`${tag}-tenant-d`, sessionId)).toEqual({
        SessionId: sessionId,
        ModelCalls: 9,
      });
    });
  });
});
