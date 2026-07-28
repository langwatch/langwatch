/**
 * @vitest-environment node
 *
 * CI runs in UTC, where a correct DateTime64 parse and a locally-anchored one
 * agree, so the decode suite below forces a non-UTC zone before importing
 * anything that touches Date. Kolkata is deliberate: its +05:30 offset also
 * catches a parse that happens to align on whole hours. The stamp suite is
 * unaffected — it works in raw epoch numbers.
 */
process.env.TZ = "Asia/Kolkata";

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
import type { ClickHouseClient } from "@clickhouse/client";
import type { CodingAgentSessionRow } from "~/server/event-sourcing/pipelines/coding-agent-processing/projections/codingAgentSession.foldProjection";
import { CodingAgentSessionClickHouseRepository } from "../coding-agent-session.clickhouse.repository";

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
    insert: async (args: { values: Array<{ UpdatedAt: Date }> }) => {
      captured.push(...args.values);
    },
  } as unknown as ClickHouseClient;
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
      query: async () => ({ json: async () => [record] }),
    } as unknown as ClickHouseClient;
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
function orderingClient(rows: Array<Record<string, unknown>>): ClickHouseClient {
  return {
    query: async (params: { query: string }) => ({
      json: async () => applyOrderBy(rows, params.query).slice(0, 1),
    }),
  } as unknown as ClickHouseClient;
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
): ClickHouseClient {
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

const read = (client: ClickHouseClient) =>
  new CodingAgentSessionClickHouseRepository(
    async () => client,
  ).findBySessionIdWithApplied({ tenantId: "tenant-1", sessionId: "sess-1" });

describe("CodingAgentSessionClickHouseRepository point-read tiebreak", () => {
  describe("given two versions of one session tied on UpdatedAt", () => {
    describe("when one applied a later event than the other", () => {
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

    describe("when they share a watermark but folded different amounts of span and log work", () => {
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

    describe("when the session is metric-only, so every span and log counter stays zero", () => {
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

    describe("when they folded equal work but absorbed different numbers of deliveries", () => {
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

    describe("when every progress signal is identical and only the start time differs", () => {
      it("returns the version with the EARLIER start time, which is the better-informed one", async () => {
        // StartedAt is min(occurredAt) and only ever moves backwards, so the
        // smallest value belongs to the version that saw the earliest signal.
        const result = await read(
          tiedVersions(
            { StartedAt: "2026-07-24 11:30:00.000", Commits: 1 },
            { StartedAt: "2026-07-24 09:00:00.000", Commits: 9 },
          ),
        );

        expect(result?.row.commits).toBe(9);
      });
    });
  });
});
