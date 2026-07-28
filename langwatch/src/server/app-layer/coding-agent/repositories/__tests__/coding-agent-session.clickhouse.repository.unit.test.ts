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
