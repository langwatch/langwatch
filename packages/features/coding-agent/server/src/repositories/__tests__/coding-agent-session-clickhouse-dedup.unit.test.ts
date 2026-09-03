/**
 * @vitest-environment node
 *
 * Dedup and tiebreak behaviour of the session ClickHouse repository
 * (ADR-071): what happens when two versions of one session tie on the RMT
 * `max(UpdatedAt)` dedup key. The write-side version stamp and the
 * DateTime64 decode are covered by ../../adapters/__tests__/coding-agent-session-repository.unit.test.ts;
 * this file pins the read-side tiebreak the stamp defends against.
 *
 * @see specs/coding-agent/session-aggregate.feature
 */
import { describe, expect, it } from "vitest";
import { NoopCodingAgentReadMetricsPort } from "../../adapters/coding-agent-read-metrics.adapter";
import { TestClock } from "./fixtures/coding-agent.fixture";
import type {
  CodingAgentClickHouseClient,
  CodingAgentClickHouseQueryResult,
} from "../../ports/coding-agent-clickhouse.port";
import { CodingAgentClickHousePort } from "../../ports/coding-agent-clickhouse.port";
import { parseClickHouseDateTimeMs } from "../coding-agent-clickhouse/clickhouse.repository";
import { CodingAgentSessionClickHouseRepository } from "../coding-agent-session/clickhouse.repository";

/**
 * ClickHouse renders DateTime64 without a timezone suffix, and the
 * repository reads it back as UTC via `parseClickHouseDateTimeMs`.
 * Formatting in UTC keeps the fixture's millisecond round-trip exact.
 */
function chTime(ms: number): string {
  const at = new Date(ms);
  const pad = (value: number, width = 2) => String(value).padStart(width, "0");
  return (
    `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())} ` +
    `${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())}:${pad(at.getUTCSeconds())}.` +
    `${pad(at.getUTCMilliseconds(), 3)}`
  );
}

const millis = (value: unknown): number => parseClickHouseDateTimeMs(String(value));

function makePort(client: CodingAgentClickHouseClient): CodingAgentClickHousePort {
  class Port extends CodingAgentClickHousePort {
    async resolve(): Promise<CodingAgentClickHouseClient> {
      return client;
    }
  }
  return new Port();
}

function makeRepository(client: CodingAgentClickHouseClient) {
  return CodingAgentSessionClickHouseRepository.create({
    clickHouse: makePort(client),
    defaultTraceRetentionDays: 30,
    metrics: NoopCodingAgentReadMetricsPort.create(),
    clock: new TestClock(),
  });
}

/**
 * Understands only the grammar this repository emits: comma-separated
 * `<expression> ASC|DESC` keys before LIMIT, where an expression is a column,
 * a `length(<column>)`, or a `+`-separated sum of columns.
 */
function applyOrderBy(
  rows: Array<Record<string, unknown>>,
  query: string,
): Array<Record<string, unknown>> {
  const clause = /ORDER BY([\s\S]*?)LIMIT/i.exec(query)?.[1];
  if (clause === undefined) return [...rows];

  const keys = clause
    .split(",")
    .map((key) => key.trim())
    .filter((key) => key.length > 0)
    .map((key) => ({
      descending: /\bDESC\b/i.test(key),
      expression: key.replace(/\b(ASC|DESC)\b/i, "").trim(),
    }));

  return [...rows].sort((left, right) => {
    for (const { expression, descending } of keys) {
      const a = evaluate(left, expression);
      const b = evaluate(right, expression);
      if (a === b) continue;
      return (a < b ? -1 : 1) * (descending ? -1 : 1);
    }
    return 0;
  });
}

/** UInt64 columns arrive as strings on the wire; DateTime64 sorts lexically. */
function evaluate(row: Record<string, unknown>, expression: string): number | string {
  const arrayLength = /^length\((.+)\)$/i.exec(expression);
  if (arrayLength) {
    const value = row[arrayLength[1]!.trim()];
    return Array.isArray(value) ? value.length : 0;
  }
  if (expression.includes("+")) {
    return expression
      .split("+")
      .reduce((sum, column) => sum + Number(row[column.trim()] ?? 0), 0);
  }
  const raw = row[expression];
  if (typeof raw === "number") return raw;
  const asString = String(raw ?? "");
  return asString !== "" && !Number.isNaN(Number(asString)) ? Number(asString) : asString;
}

/**
 * A client that answers a point read by applying the repository's own
 * emitted `ORDER BY … LIMIT 1` to the candidate rows, rather than replaying
 * whichever row the fixture pushed first.
 */
function orderingClient(rows: Array<Record<string, unknown>>): CodingAgentClickHouseClient {
  return {
    query: async (params: { query: string }): Promise<CodingAgentClickHouseQueryResult> => ({
      json: async () => applyOrderBy(rows, params.query).slice(0, 1),
    }),
    insert: async () => undefined,
  };
}

/**
 * Two versions of one session that TIED on UpdatedAt, so both satisfy the
 * IN-tuple dedup and the tiebreak alone decides. Defaults are identical; each
 * case overrides only the keys it is pinning.
 */
function tiedVersions(
  stale: Record<string, unknown>,
  fresh: Record<string, unknown>,
): CodingAgentClickHouseClient {
  const base = {
    TenantId: "tenant-1",
    SessionId: "sess-1",
    UpdatedAt: "2026-07-24 12:00:00.000",
    StartedAt: "2026-07-24 11:00:00.000",
    LastEventOccurredAt: "2026-07-24 11:30:00.000",
    ModelCalls: 0,
    ToolCalls: 0,
    Prompts: 0,
    MetricSeries: [],
    AppliedEventIds: [],
  };
  // Adverse order: the stale version first, so insertion order alone loses.
  return orderingClient([
    { ...base, ...stale },
    { ...base, ...fresh },
  ]);
}

const read = (client: CodingAgentClickHouseClient) =>
  makeRepository(client).tryFindBySessionIdWithApplied({
    tenantId: "tenant-1",
    sessionId: "sess-1",
  });

describe("CodingAgentSessionClickHouseRepository point-read tiebreak", () => {
  describe("given two versions of one session tied on UpdatedAt", () => {
    describe("given they share a watermark but folded different amounts of span and log work", () => {
      describe("when the session is point-read", () => {
        /** @scenario "the most complete version of a session is the one that is read" */
        it("returns the version that absorbed more contributions in total, not the one leading on any single counter", async () => {
          const result = await read(
            tiedVersions(
              { ModelCalls: 9, ToolCalls: 1, Prompts: 0, Commits: 1 },
              { ModelCalls: 2, ToolCalls: 8, Prompts: 3, Commits: 9 },
            ),
          );

          expect(result?.row.commits).toBe(9);
        });
      });
    });

    describe("given a metric-only session, so every span and log counter stays zero", () => {
      describe("when the session is point-read", () => {
        /** @scenario "the most complete version of a session is the one that is read" */
        it("returns the version holding more converged metric units", async () => {
          const result = await read(
            tiedVersions(
              { MetricSeries: [["s1", "cost", "", "", "", 1]], Commits: 1 },
              {
                MetricSeries: [
                  ["s1", "cost", "", "", "", 1],
                  ["s2", "commits", "", "", "", 9],
                ],
                Commits: 9,
              },
            ),
          );

          expect(result?.row.commits).toBe(9);
        });
      });
    });

    describe("given they folded equal work but absorbed different numbers of deliveries", () => {
      describe("when the session is point-read", () => {
        /** @scenario "the most complete version of a session is the one that is read" */
        it("returns the version with more applied events", async () => {
          const result = await read(
            tiedVersions(
              { AppliedEventIds: ["e1"], Commits: 1 },
              { AppliedEventIds: ["e1", "e2"], Commits: 9 },
            ),
          );

          expect(result?.row.commits).toBe(9);
        });
      });
    });

    describe("given every progress signal is identical and only the start time differs", () => {
      describe("when the session is point-read", () => {
        /** @scenario "the most complete version of a session is the one that is read" */
        it("resolves the fully-tied case the same way whichever order the rows arrive in", async () => {
          // StartedAt is the last-resort key that makes the ordering TOTAL,
          // and nothing more. WHICH of the two it lands on carries no
          // meaning: StartedAt can be re-stamped FORWARDS when a read-back
          // miss re-runs init() (ADR-071), so its direction is not a
          // progress signal. What is pinned here is that the pick is
          // deterministic — ASC — and identical under the opposite
          // insertion order rather than whatever the scan happened to emit
          // first.
          const later = { StartedAt: "2026-07-24 11:30:00.000", Commits: 1 };
          const earlier = { StartedAt: "2026-07-24 09:00:00.000", Commits: 9 };

          const forward = await read(tiedVersions(later, earlier));
          const reversed = await read(tiedVersions(earlier, later));

          expect(forward?.row.commits).toBe(9);
          expect(reversed?.row.commits).toBe(9);
        });
      });
    });
  });
});

/**
 * Splits the emitted list query into its two scopes: the inner
 * `max(UpdatedAt)` dedup subquery, and everything outside it.
 */
function splitScopes(query: string): { inner: string; outer: string } {
  const open = query.indexOf("(", query.indexOf("IN ("));
  let depth = 0;
  let close = open;
  for (let index = open; index < query.length; index++) {
    if (query[index] === "(") depth++;
    else if (query[index] === ")" && --depth === 0) {
      close = index;
      break;
    }
  }
  return {
    inner: query.slice(open + 1, close),
    outer: query.slice(0, open) + query.slice(close + 1),
  };
}

const boundsStartedAt = (scope: string): boolean => /StartedAt\s+BETWEEN/i.test(scope);
const narrowsToUser = (scope: string): boolean => /UserId\s*=/i.test(scope);

/** Applies whichever predicates the repository actually put in this scope. */
function inScope(
  row: Record<string, unknown>,
  scope: string,
  params: Record<string, unknown>,
): boolean {
  if (row.TenantId !== params.tenantId) return false;
  if (narrowsToUser(scope) && row.UserId !== params.userId) return false;
  if (!boundsStartedAt(scope)) return true;
  const startedAt = millis(row.StartedAt);
  return startedAt >= Number(params.from) && startedAt <= Number(params.to);
}

/**
 * A client that ANSWERS the list read by executing both scopes off the SQL
 * the repository sent, rather than replaying the fixture.
 *
 * A passthrough mock would return whatever rows it was handed, so windowing
 * the inner dedup subquery (the ADR-071 consequence-4 bug) would still look
 * correct. Here the inner's predicates decide which version wins
 * `max(UpdatedAt)`, so putting the range filter back changes the ANSWER: the
 * drifted session reappears as its stale in-window version.
 */
function listClient(rows: Array<Record<string, unknown>>): {
  client: CodingAgentClickHouseClient;
  lastQuery: () => string;
} {
  let sent = "";
  const client: CodingAgentClickHouseClient = {
    query: async (args: {
      query: string;
      query_params?: Record<string, unknown>;
    }): Promise<CodingAgentClickHouseQueryResult> => {
      sent = args.query;
      const params = args.query_params ?? {};
      const { inner, outer } = splitScopes(args.query);

      const latest = new Map<string, number>();
      for (const row of rows) {
        if (!inScope(row, inner, params)) continue;
        const key = `${String(row.TenantId)} ${String(row.SessionId)}`;
        latest.set(key, Math.max(latest.get(key) ?? -Infinity, millis(row.UpdatedAt)));
      }

      const selected = rows
        .filter((row) => inScope(row, outer, params))
        .filter(
          (row) =>
            latest.get(`${String(row.TenantId)} ${String(row.SessionId)}`) ===
            millis(row.UpdatedAt),
        )
        .sort((left, right) => millis(right.StartedAt) - millis(left.StartedAt))
        .slice(0, Number(params.limit));

      return { json: async () => selected };
    },
    insert: async () => undefined,
  };

  return { client, lastQuery: () => sent };
}

const WINDOW_FROM = new Date("2026-07-24T00:00:00.000Z").getTime();
const WINDOW_TO = new Date("2026-07-24T23:59:59.999Z").getTime();
const DAY_MS = 24 * 60 * 60 * 1000;

/** One persisted version of a session. Only the read's own columns matter. */
function version({
  sessionId,
  startedAtMs,
  updatedAtMs,
  costUsd,
  userId = "user-1",
}: {
  sessionId: string;
  startedAtMs: number;
  updatedAtMs: number;
  costUsd: number;
  userId?: string;
}): Record<string, unknown> {
  return {
    TenantId: "tenant-1",
    SessionId: sessionId,
    UserId: userId,
    StartedAt: chTime(startedAtMs),
    UpdatedAt: chTime(updatedAtMs),
    CostUsd: costUsd,
  };
}

const listRecent = (client: CodingAgentClickHouseClient, userId?: string) =>
  makeRepository(client).findManyRecent({
    tenantId: "tenant-1",
    fromMs: WINDOW_FROM,
    toMs: WINDOW_TO,
    limit: 50,
    ...(userId !== undefined ? { userId } : {}),
  });

describe("CodingAgentSessionClickHouseRepository list-read dedup scope", () => {
  describe("given a windowed list read", () => {
    describe("when the query is emitted", () => {
      it("bounds StartedAt on the outer scope only, so the dedup resolves the true latest version", async () => {
        const { client, lastQuery } = listClient([]);

        await listRecent(client);

        const { inner, outer } = splitScopes(lastQuery());
        expect(boundsStartedAt(outer)).toBe(true);
        expect(boundsStartedAt(inner)).toBe(false);
      });

      it("narrows to the user on the outer scope only, keeping just the key narrowing in the dedup group", async () => {
        const { client, lastQuery } = listClient([]);

        await listRecent(client, "user-1");

        const { inner, outer } = splitScopes(lastQuery());
        expect(narrowsToUser(outer)).toBe(true);
        // `UserId` looks stable and is not: spans carry no identity, and a
        // re-fold restarts from init(), so a later version can hold no user.
        // Only TenantId belongs in the group, because it IS part of the key.
        expect(narrowsToUser(inner)).toBe(false);
        expect(inner).toContain("TenantId = {tenantId:String}");
        expect(outer).toContain("TenantId = {tenantId:String}");
      });
    });
  });

  describe("given a session whose true latest version carries no user id", () => {
    describe("when that user's sessions are listed", () => {
      /** @scenario "a user-narrowed list is never answered from a superseded version" */
      it("omits the session rather than serving the superseded version's totals", async () => {
        // v1 folded from Claude's log events, which stamp identity. v2 — the
        // true latest — folded from spans, which carry none, after a
        // read-back miss re-ran init() and cleared the user. Narrowing the
        // dedup scope on UserId would hide v2 from its own group, resolve
        // max(UpdatedAt) to v1, and answer with v1's stale cost under the
        // user's filter.
        const { client } = listClient([
          version({
            sessionId: "identified",
            startedAtMs: WINDOW_FROM + 60_000,
            updatedAtMs: WINDOW_FROM + 60_000,
            costUsd: 1,
          }),
          version({
            sessionId: "identified",
            startedAtMs: WINDOW_FROM + 60_000,
            updatedAtMs: WINDOW_FROM + 120_000,
            costUsd: 9,
            userId: "",
          }),
        ]);

        const rows = await listRecent(client, "user-1");

        expect(rows).toEqual([]);
      });
    });
  });

  describe("given more tied duplicates than the page has room for", () => {
    describe("when a full page is listed", () => {
      /** @scenario "a page is never shortened by collapsing a session's tied versions" */
      it("still returns a full page of distinct sessions", async () => {
        // Every session has two versions tied on UpdatedAt, so both satisfy
        // the IN-tuple and the collapse halves whatever the query returned.
        // Cutting the page to `limit` in ClickHouse would hand the caller 25
        // sessions for a 50-session page — and through getUsageTotals, 25
        // sessions' cost silently missing.
        const rows: Array<Record<string, unknown>> = [];
        for (let index = 0; index < 60; index++) {
          const startedAtMs = WINDOW_FROM + index * 60_000;
          const updatedAtMs = WINDOW_FROM + index * 60_000;
          rows.push(
            version({ sessionId: `session-${index}`, startedAtMs, updatedAtMs, costUsd: 1 }),
            version({ sessionId: `session-${index}`, startedAtMs, updatedAtMs, costUsd: 1 }),
          );
        }
        const { client } = listClient(rows);

        const listed = await listRecent(client);

        expect(listed).toHaveLength(50);
        expect(new Set(listed.map((row) => row.sessionId)).size).toBe(50);
      });
    });
  });

  describe("given a session whose true latest version backdated StartedAt out of the window", () => {
    describe("when the window is listed", () => {
      /** @scenario "a session is never listed under a start time it has moved off" */
      it("omits the session entirely rather than rendering its stale in-window version", async () => {
        // v1 landed inside the window; v2 — the true latest — moved
        // StartedAt a day earlier, so the session no longer starts in this
        // window. A dedup scope filtered on StartedAt would never see v2 and
        // would hand the outer scope v1's stale totals under a start time
        // that no longer exists.
        const { client } = listClient([
          version({
            sessionId: "drifted",
            startedAtMs: WINDOW_FROM + 10 * 60_000,
            updatedAtMs: WINDOW_FROM + 10 * 60_000,
            costUsd: 1,
          }),
          version({
            sessionId: "drifted",
            startedAtMs: WINDOW_FROM - DAY_MS,
            updatedAtMs: WINDOW_FROM + 20 * 60_000,
            costUsd: 2,
          }),
          version({
            sessionId: "steady",
            startedAtMs: WINDOW_FROM + 60 * 60_000,
            updatedAtMs: WINDOW_FROM + 60 * 60_000,
            costUsd: 7,
          }),
        ]);

        const listed = await listRecent(client);

        expect(listed.map((row) => row.sessionId)).toEqual(["steady"]);
      });
    });
  });

  describe("given a session whose true latest version is inside the window", () => {
    describe("given an older version of it sits outside the window", () => {
      describe("when the window is listed", () => {
        /** @scenario "a session whose earliest signal arrives late is listed once, up to date" */
        it("returns the latest version's totals, not the out-of-window one's", async () => {
          // The mirror case: a read-back miss re-ran init() and re-stamped
          // StartedAt FORWARD, into the window. The unwindowed dedup must
          // still resolve v2, and the outer scope must still admit it.
          const { client } = listClient([
            version({
              sessionId: "readmitted",
              startedAtMs: WINDOW_FROM - DAY_MS,
              updatedAtMs: WINDOW_FROM + 10 * 60_000,
              costUsd: 1,
            }),
            version({
              sessionId: "readmitted",
              startedAtMs: WINDOW_FROM + 30 * 60_000,
              updatedAtMs: WINDOW_FROM + 40 * 60_000,
              costUsd: 5,
            }),
          ]);

          const listed = await listRecent(client);

          expect(listed).toHaveLength(1);
          expect(listed[0]!.costUsd).toBeCloseTo(5);
        });
      });
    });
  });

  describe("given two versions of one session tied on max(UpdatedAt)", () => {
    describe("when the window is listed", () => {
      /** @scenario "a session stored as two indistinguishable versions is listed once" */
      it("lists the session once, with the further-along version's totals", async () => {
        // Both versions satisfy the IN-tuple: they share max(UpdatedAt) and
        // differ in StartedAt, so the RMT never collapses them either.
        // Without a per-session tiebreak the session renders twice and
        // getUsageTotals adds its cost twice.
        const tied = WINDOW_FROM + 30 * 60_000;
        const { client } = listClient([
          {
            ...version({
              sessionId: "tied",
              startedAtMs: WINDOW_FROM + 10 * 60_000,
              updatedAtMs: tied,
              costUsd: 3,
            }),
            LastEventOccurredAt: chTime(WINDOW_FROM + 20 * 60_000),
            ModelCalls: 2,
          },
          {
            ...version({
              sessionId: "tied",
              startedAtMs: WINDOW_FROM + 5 * 60_000,
              updatedAtMs: tied,
              costUsd: 9,
            }),
            LastEventOccurredAt: chTime(WINDOW_FROM + 25 * 60_000),
            ModelCalls: 5,
          },
        ]);

        const listed = await listRecent(client);

        expect(listed).toHaveLength(1);
        // The version that applied the later event, not whichever came back
        // first off the wire.
        expect(listed[0]!.costUsd).toBeCloseTo(9);
      });
    });
  });

  describe("given a session listed under a user narrowing", () => {
    describe("given another user's session sits in the same window", () => {
      describe("when the window is listed", () => {
        it("still lists only the requesting user's sessions", async () => {
          const { client } = listClient([
            version({
              sessionId: "mine",
              startedAtMs: WINDOW_FROM + 10 * 60_000,
              updatedAtMs: WINDOW_FROM + 10 * 60_000,
              costUsd: 4,
              userId: "user-1",
            }),
            version({
              sessionId: "theirs",
              startedAtMs: WINDOW_FROM + 20 * 60_000,
              updatedAtMs: WINDOW_FROM + 20 * 60_000,
              costUsd: 8,
              userId: "user-2",
            }),
          ]);

          const listed = await listRecent(client, "user-1");

          expect(listed.map((row) => row.sessionId)).toEqual(["mine"]);
        });
      });
    });
  });
});
