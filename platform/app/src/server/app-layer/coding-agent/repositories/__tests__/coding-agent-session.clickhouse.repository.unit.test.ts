/**
 * @vitest-environment node
 *
 * CI runs in UTC, where a correct DateTime64 parse and a locally-anchored one
 * agree, so the decode suite below forces a non-UTC zone before importing
 * anything that touches Date. Kolkata is deliberate: its +05:30 offset also
 * catches a parse that happens to align on whole hours. The stamp suite is
 * unaffected — it works in raw epoch numbers.
 */
// Through node:process, NOT the global. Under a vm pool with isolate:false a
// worker reuses one context across files, and the `process` global vitest
// hands that context wraps the real one — assigning TZ on it misses Node's
// native env setter, which is the thing that flushes V8's cached timezone.
// So whenever another file had already used Date in this worker, the
// assignment silently did nothing, the guard below collapsed to "expected +0
// not to be +0", and which files shared a worker depended on the sequencer —
// a per-shard coin flip. node:process is the real object; its setter flushes
// the cache even mid-context. Verified against a deterministic repro
// (TZ=UTC, one worker, a Date-using suite loaded first).
import { env as nodeProcessEnv } from "node:process";

nodeProcessEnv.TZ = "Asia/Kolkata";

import type { TenantClickHouseClient } from "~/server/app-layer/clients/clickhouse/tenant-client";
import { register } from "prom-client";
/**
 * The RMT version stamp. The IN-tuple dedup read depends on the repo-wide
 * invariant that no two versions of one row tie on UpdatedAt
 * (dev/docs/best_practices/clickhouse-queries.md): a tie makes both versions
 * match max(UpdatedAt), so a windowed read can return a stale in-window
 * version instead of empty. The full write→read contract, including the
 * drifted-window scenario, lives in the sibling integration suite against
 * real ClickHouse; this suite pins the stamp seam itself.
 */
import { describe, expect, it, vi } from "vitest";
import { parseClickHouseDateTimeMs } from "~/server/clickhouse/dateTime";
import { CodingAgentSessionClickHouseRepository } from "../coding-agent-session.clickhouse.repository";
import type { CodingAgentSessionRow } from "../coding-agent-session.repository";

/**
 * The stamp logic reads only identity, bookkeeping timestamps and the
 * threaded prior version; the remaining ~80 columns are irrelevant to it, so
 * the fixture stays a partial cast rather than a full row factory.
 */
function rowWith(over: Partial<CodingAgentSessionRow>): CodingAgentSessionRow {
  return {
    tenantId: "tenant-1",
    sessionId: "sess-1",
    startedAtMs: 1_000,
    createdAt: 1_000,
    updatedAt: 0,
    traceIds: [],
    metricSeries: [],
    stepStartedAt: [],
    subAgentIds: [],
    steps: [],
    toolCounts: {},
    toolDurationMs: {},
    filesTouched: [],
    skills: [],
    subAgentTypes: [],
    slashCommands: [],
    models: [],
    mcpServers: [],
    mcpTools: [],
    errorTypes: {},
    refusalCategories: [],
    languagesEdited: [],
    ...over,
  } as unknown as CodingAgentSessionRow;
}

function makeRepository() {
  const captured: Array<{ UpdatedAt: Date }> = [];
  const client = {
    insert: async (args: { rows: Array<{ UpdatedAt: Date }> }) => {
      captured.push(...args.rows);
    },
  } as unknown as TenantClickHouseClient;
  const repository = new CodingAgentSessionClickHouseRepository(
    async () => client,
  );
  return { repository, captured };
}

/** Freezes the clock for one case so every stamp starts from the same now. */
async function withFrozenClock(run: () => Promise<void>): Promise<void> {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-24T12:00:00.000Z"));
  try {
    await run();
  } finally {
    vi.useRealTimers();
  }
}

describe("CodingAgentSessionClickHouseRepository version stamp", () => {
  describe("given two versions of one session inside the same millisecond", () => {
    describe("when both are written through the repository", () => {
      it("stamps strictly increasing versions so the latest always wins", async () => {
        await withFrozenClock(async () => {
          const { repository, captured } = makeRepository();

          await repository.upsert(rowWith({ updatedAt: 0 }));
          await repository.upsert(rowWith({ updatedAt: 0 }));

          expect(captured).toHaveLength(2);
          expect(captured[1]!.UpdatedAt.getTime()).toBeGreaterThan(
            captured[0]!.UpdatedAt.getTime(),
          );
        });
      });
    });
  });

  describe("given a row threading its superseded version's timestamp", () => {
    describe("when it is written while this writer's clock lags that prior", () => {
      it("stamps past the prior version", async () => {
        await withFrozenClock(async () => {
          const { repository, captured } = makeRepository();
          const priorMs = Date.now() + 60_000;

          await repository.upsert(rowWith({ updatedAt: priorMs }));

          expect(captured[0]!.UpdatedAt.getTime()).toBeGreaterThan(priorMs);
        });
      });
    });
  });

  describe("given a batch of versions for one session", () => {
    describe("when the batch is written in one insert", () => {
      it("stamps each entry past the one before it", async () => {
        await withFrozenClock(async () => {
          const { repository, captured } = makeRepository();

          await repository.upsertBatch([
            { row: rowWith({ updatedAt: 0 }) },
            { row: rowWith({ updatedAt: 0 }) },
            { row: rowWith({ updatedAt: 0 }) },
          ]);

          const stamps = captured.map((r) => r.UpdatedAt.getTime());
          expect(stamps).toHaveLength(3);
          expect(stamps[1]).toBeGreaterThan(stamps[0]!);
          expect(stamps[2]).toBeGreaterThan(stamps[1]!);
        });
      });
    });
  });
});

/**
 * DateTime64 decode is timezone-safe.
 *
 * ClickHouse emits DateTime64(3) without a zone suffix
 * ("2026-07-24 12:00:00.123") and V8 reads a bare datetime as LOCAL time, so
 * `new Date(str)` skews every timestamp by the host's UTC offset.
 *
 * `LastEventOccurredAt` makes that load-bearing rather than cosmetic:
 * `CodingAgentSessionStore` reads it as the "was this row written after
 * migration 00053" discriminator, on the reasoning that the column defaults to 0
 * on every row that predates it. A pre-00053 row comes back as the epoch, and
 * anywhere west of UTC a local-time parse turns that into a POSITIVE number — so
 * the gate would decode exactly the rows it exists to reject, and the fold would
 * resume from fabricated state instead of refolding.
 */
describe("CodingAgentSessionClickHouseRepository DateTime64 decode", () => {
  function repositoryReturning(record: Record<string, unknown>) {
    const client = {
      query: async () => [record],
    } as unknown as TenantClickHouseClient;
    return new CodingAgentSessionClickHouseRepository(async () => client);
  }

  const RECORD = {
    TenantId: "tenant-1",
    SessionId: "sess-1",
    Version: "2026-07-21",
    StartedAt: "2026-07-24 12:00:00.000",
    CreatedAt: "2026-07-24 12:00:00.000",
    UpdatedAt: "2026-07-24 12:00:02.500",
  };

  describe("given a row whose columns carry no timezone suffix", () => {
    describe("when it is read back on a host that is not on UTC", () => {
      it("decodes them as UTC rather than the host's local time", async () => {
        // Guards the guard: if Node ever stops honouring a runtime TZ change,
        // this suite would pass vacuously under CI's UTC.
        expect(new Date().getTimezoneOffset()).not.toBe(0);

        const repository = repositoryReturning({
          ...RECORD,
          LastEventOccurredAt: "2026-07-24 12:00:01.250",
        });

        const found = await repository.findBySessionIdWithApplied({
          tenantId: "tenant-1",
          sessionId: "sess-1",
        });

        expect(found?.row.startedAtMs).toBe(Date.parse("2026-07-24T12:00:00Z"));
        expect(found?.row.updatedAt).toBe(
          Date.parse("2026-07-24T12:00:02.500Z"),
        );
        expect(found?.row.lastEventOccurredAt).toBe(
          Date.parse("2026-07-24T12:00:01.250Z"),
        );
      });
    });
  });

  describe("given a pre-00053 row whose checkpoint is the column default", () => {
    describe("when it is read back off UTC in either direction", () => {
      it("decodes the checkpoint as 0 so the store's gate still rejects it", async () => {
        // West of UTC the skew is positive and the gate would ACCEPT the row;
        // east it is merely non-zero. Either way the only safe answer is 0.
        const repository = repositoryReturning({
          ...RECORD,
          LastEventOccurredAt: "1970-01-01 00:00:00.000",
        });

        const found = await repository.findBySessionIdWithApplied({
          tenantId: "tenant-1",
          sessionId: "sess-1",
        });

        expect(found?.row.lastEventOccurredAt).toBe(0);
      });
    });
  });
});

/**
 * A client that actually APPLIES the ORDER BY the repository sent, to rows
 * handed over in a deliberately adverse order (the stale version first).
 *
 * A passthrough mock would return the fixture's own insertion order and pass
 * whatever the repository did, so a dropped tiebreak — or one aimed at the
 * wrong column or direction — would go unnoticed. Here the stale version wins
 * unless the repository ordered correctly.
 *
 * A local equivalent of the analytics suites' shared fake rather than an import
 * of it: that helper lives on an unmerged branch, and its grammar does not
 * cover the summed key this repository emits.
 */
function orderingClient(
  rows: Array<Record<string, unknown>>,
): TenantClickHouseClient {
  return {
    query: async (params: { sql: string }) =>
      applyOrderBy(rows, params.sql).slice(0, 1),
  } as unknown as TenantClickHouseClient;
}

/**
 * Understands only the grammar this repository emits: comma-separated
 * `<expression> ASC|DESC` keys before LIMIT, where an expression is a column, a
 * `length(<column>)`, or a `+`-separated sum of columns.
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
function evaluate(
  row: Record<string, unknown>,
  expression: string,
): number | string {
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
  return asString !== "" && !Number.isNaN(Number(asString))
    ? Number(asString)
    : asString;
}

/**
 * Two versions of one session that TIED on UpdatedAt, so both satisfy the
 * IN-tuple dedup and the tiebreak alone decides. Defaults are identical; each
 * case overrides only the keys it is pinning.
 */
function tiedVersions(
  stale: Record<string, unknown>,
  fresh: Record<string, unknown>,
): TenantClickHouseClient {
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

const read = (client: TenantClickHouseClient) =>
  new CodingAgentSessionClickHouseRepository(
    async () => client,
  ).findBySessionIdWithApplied({ tenantId: "tenant-1", sessionId: "sess-1" });

describe("CodingAgentSessionClickHouseRepository point-read tiebreak", () => {
  describe("given two versions of one session tied on UpdatedAt", () => {
    describe("given one applied a later event than the other", () => {
      describe("when the session is point-read", () => {
        it("returns the version with the higher progress watermark", async () => {
          const result = await read(
            tiedVersions(
              { LastEventOccurredAt: "2026-07-24 11:00:00.000", Commits: 1 },
              { LastEventOccurredAt: "2026-07-24 11:45:00.000", Commits: 9 },
            ),
          );

          expect(result?.row.commits).toBe(9);
        });
      });
    });

    describe("given they share a watermark but folded different amounts of span and log work", () => {
      describe("when the session is point-read", () => {
        /** @scenario the most complete version of a session is the one that is read */
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
        /** @scenario the most complete version of a session is the one that is read */
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
        /** @scenario the most complete version of a session is the one that is read */
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
        /** @scenario the most complete version of a session is the one that is read */
        it("resolves the fully-tied case the same way whichever order the rows arrive in", async () => {
          // StartedAt is the last-resort key that makes the ordering TOTAL, and
          // nothing more. WHICH of the two it lands on carries no meaning:
          // StartedAt can be re-stamped FORWARDS when a read-back miss re-runs
          // init() (ADR-071), so its direction is not a progress signal. What is
          // pinned here is that the pick is deterministic — ASC, and identical
          // under the opposite insertion order rather than whatever the scan
          // happened to emit first.
          const later = { StartedAt: "2026-07-24 11:30:00.000", Commits: 1 };
          const earlier = { StartedAt: "2026-07-24 09:00:00.000", Commits: 9 };

          const result = await read(tiedVersions(later, earlier));
          const reversed = await read(tiedVersions(earlier, later));

          expect(result?.row.commits).toBe(9);
          expect(reversed?.row.commits).toBe(9);
        });
      });
    });
  });
});

/**
 * ClickHouse renders DateTime64 without a timezone suffix, and `fromRecord`
 * reads it back as UTC via `parseClickHouseDateTimeMs`. Formatting in UTC is
 * what keeps the fixture's millisecond round-trip exact.
 *
 * This deliberately does NOT use the local-time getters. This suite forces a
 * non-UTC zone, so local formatting would offset every fixture by that zone and
 * silently stop the round-trip being exact — which is invisible while the
 * assertions only care which row came back, and a trap the moment one asserts a
 * timestamp.
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

/**
 * Parses exactly as the repository does. A bare `new Date(str)` would read
 * ClickHouse's zone-less DateTime64 as LOCAL time, and this suite forces a
 * non-UTC zone — so the fake would disagree with production about which rows
 * fall inside the requested window, and the window assertions would be
 * measuring the fake's bug rather than the repository's behaviour.
 */
const millis = (value: unknown): number =>
  parseClickHouseDateTimeMs(String(value));

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

const boundsStartedAt = (scope: string): boolean =>
  /StartedAt\s+BETWEEN/i.test(scope);
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
 * A client that ANSWERS the list read by executing both scopes off the SQL the
 * repository sent, rather than replaying the fixture.
 *
 * A passthrough mock would return whatever rows it was handed, so windowing the
 * inner dedup subquery — the ADR-071 consequence-4 bug — would still look
 * correct. Here the inner's predicates decide which version wins
 * `max(UpdatedAt)`, so putting the range filter back changes the ANSWER: the
 * drifted session reappears as its stale in-window version.
 */
function listClient(rows: Array<Record<string, unknown>>): {
  client: TenantClickHouseClient;
  lastQuery: () => string;
} {
  let sent = "";
  const client = {
    query: async (args: {
      sql: string;
      params: Record<string, unknown>;
    }) => {
      sent = args.sql;
      const { inner, outer } = splitScopes(args.sql);

      const latest = new Map<string, number>();
      for (const row of rows) {
        if (!inScope(row, inner, args.params)) continue;
        const key = `${String(row.TenantId)}\u0000${String(row.SessionId)}`;
        latest.set(
          key,
          Math.max(latest.get(key) ?? -Infinity, millis(row.UpdatedAt)),
        );
      }

      const selected = rows
        .filter((row) => inScope(row, outer, args.params))
        .filter(
          (row) =>
            latest.get(
              `${String(row.TenantId)}\u0000${String(row.SessionId)}`,
            ) === millis(row.UpdatedAt),
        )
        .sort((left, right) => millis(right.StartedAt) - millis(left.StartedAt))
        .slice(0, Number(args.params.limit));

      return selected;
    },
  } as unknown as TenantClickHouseClient;

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

const listRecent = (
  client: TenantClickHouseClient,
  userId?: string,
): Promise<CodingAgentSessionRow[]> =>
  new CodingAgentSessionClickHouseRepository(async () => client).findManyRecent(
    {
      tenantId: "tenant-1",
      fromMs: WINDOW_FROM,
      toMs: WINDOW_TO,
      limit: 50,
      ...(userId !== undefined ? { userId } : {}),
    },
  );

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
      /** @scenario a user-narrowed list is never answered from a superseded version */
      it("omits the session rather than serving the superseded version's totals", async () => {
        // v1 folded from Claude's log events, which stamp identity. v2 — the
        // true latest — folded from spans, which carry none, after a read-back
        // miss re-ran init() and cleared the user. Narrowing the dedup scope
        // on UserId would hide v2 from its own group, resolve max(UpdatedAt)
        // to v1, and answer with v1's stale cost under the user's filter.
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
      /** @scenario a page is never shortened by collapsing a session's tied versions */
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
            version({
              sessionId: `session-${index}`,
              startedAtMs,
              updatedAtMs,
              costUsd: 1,
            }),
            version({
              sessionId: `session-${index}`,
              startedAtMs,
              updatedAtMs,
              costUsd: 1,
            }),
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
      /** @scenario a session is never listed under a start time it has moved off */
      it("omits the session entirely rather than rendering its stale in-window version", async () => {
        // v1 landed inside the window; v2 — the true latest — moved StartedAt
        // a day earlier, so the session no longer starts in this window. A
        // dedup scope filtered on StartedAt would never see v2 and would hand
        // the outer scope v1's stale totals under a start time that no longer
        // exists.
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
        /** @scenario a session whose earliest signal arrives late is listed once, up to date */
        it("returns the latest version's totals, not the out-of-window one's", async () => {
          // The mirror case: a read-back miss re-ran init() and re-stamped
          // StartedAt FORWARD, into the window. The unwindowed dedup must still
          // resolve v2, and the outer scope must still admit it.
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
      /** @scenario a session stored as two indistinguishable versions is listed once */
      it("lists the session once, with the further-along version's totals", async () => {
        // Both versions satisfy the IN-tuple: they share max(UpdatedAt) and
        // differ in StartedAt, so the RMT never collapses them either. Without a
        // per-session tiebreak the session renders twice and getUsageTotals adds
        // its cost twice.
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
              costUsd: 3,
              userId: "user-1",
            }),
            version({
              sessionId: "theirs",
              startedAtMs: WINDOW_FROM + 20 * 60_000,
              updatedAtMs: WINDOW_FROM + 20 * 60_000,
              costUsd: 4,
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

/**
 * Reads the list-read duration histogram's observation count straight off the
 * prom registry, for this table — a spy on a destructured copy would intercept
 * nothing and pass regardless. Deltas, never absolutes: the registry is
 * process-wide, so every earlier suite in this file that lists a window has
 * already moved these counters.
 *
 * The `+Inf` bucket is the count: it is cumulative over every bucket, so it
 * holds every observation carrying these labels. It is also the only typed way
 * to ask — prom-client stamps `metricName` on each value at runtime but leaves
 * it off the published `MetricValue`.
 */
async function listReadObservations(outcome: string): Promise<number> {
  const metric = await register
    .getSingleMetric("coding_agent_session_list_read_duration_milliseconds")
    ?.get();
  return (
    metric?.values.find(
      (value) =>
        value.labels.le === "+Inf" &&
        value.labels.table === "coding_agent_sessions" &&
        value.labels.outcome === outcome,
    )?.value ?? 0
  );
}

/**
 * ADR-071 sequencing step 2 traded partition pruning on the dedup scope for a
 * correct answer, and step 3's freeze — the thing that buys the pruning back —
 * is deferred on the claim that the unpruned scan stays cheap. These pin the
 * only evidence that claim will ever have.
 */
describe("CodingAgentSessionClickHouseRepository list-read cost signal", () => {
  describe("given a window holding a session", () => {
    describe("when the window is listed", () => {
      it("times the read under the hit outcome", async () => {
        const beforeHit = await listReadObservations("hit");
        const beforeEmpty = await listReadObservations("empty");
        const { client } = listClient([
          version({
            sessionId: "listed",
            startedAtMs: WINDOW_FROM + 10 * 60_000,
            updatedAtMs: WINDOW_FROM + 10 * 60_000,
            costUsd: 2,
          }),
        ]);

        await listRecent(client);

        expect(await listReadObservations("hit")).toBe(beforeHit + 1);
        expect(await listReadObservations("empty")).toBe(beforeEmpty);
      });
    });
  });

  describe("given a window holding no sessions", () => {
    describe("when the window is listed", () => {
      it("times the read under the empty outcome, which is where the unpruned scan shows up alone", async () => {
        const beforeEmpty = await listReadObservations("empty");
        const beforeHit = await listReadObservations("hit");
        const { client } = listClient([]);

        await listRecent(client);

        expect(await listReadObservations("empty")).toBe(beforeEmpty + 1);
        expect(await listReadObservations("hit")).toBe(beforeHit);
      });
    });
  });

  describe("given a read that fails", () => {
    describe("when the window is listed", () => {
      it("times the failure under the error outcome and still raises it", async () => {
        const beforeError = await listReadObservations("error");
        const beforeHit = await listReadObservations("hit");
        const failing = {
          query: async () => {
            throw new Error("clickhouse unavailable");
          },
        } as unknown as TenantClickHouseClient;

        await expect(listRecent(failing)).rejects.toThrow(
          "clickhouse unavailable",
        );

        expect(await listReadObservations("error")).toBe(beforeError + 1);
        expect(await listReadObservations("hit")).toBe(beforeHit);
      });
    });
  });
});
