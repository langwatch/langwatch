/**
 * @vitest-environment node
 *
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
