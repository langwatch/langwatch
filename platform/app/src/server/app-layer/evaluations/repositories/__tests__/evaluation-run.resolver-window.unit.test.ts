/**
 * @vitest-environment node
 *
 * Pins the two-phase partition-hint resolver on `getByEvaluationId`: the
 * ScheduledAt seek must probe the recent window first (local-disk partitions)
 * and only fall back to an unbounded scan when the probe misses. Without the
 * bound the resolver itself walks every weekly partition incl. cold S3,
 * costing whole seconds per lookup for evaluations scheduled minutes earlier.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EvaluationRunClickHouseRepository } from "../evaluation-run.clickhouse.repository";

function createCapturingClient(
  resolverResponses: Array<string | number | null>,
) {
  const queries: Array<{
    query: string;
    query_params: Record<string, unknown>;
  }> = [];
  let resolverCall = 0;
  const client = {
    query: vi.fn(async (args: { query: string; query_params: never }) => {
      queries.push(args);
      if (args.query.includes("argMax(ScheduledAt")) {
        const value = resolverResponses[resolverCall] ?? null;
        resolverCall += 1;
        return {
          json: async () => [{ scheduledAtMs: value }],
        };
      }
      // The heavy read: return no rows; this test only cares about the
      // resolver phases and the partition predicate it produces.
      return { json: async () => [] };
    }),
  };
  return { client, queries };
}

describe("EvaluationRunClickHouseRepository ScheduledAt resolver", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-03T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("when the evaluation is recent", () => {
    it("resolves from the windowed probe and never scans unbounded", async () => {
      const scheduledAtMs = Date.now() - 60_000;
      const { client, queries } = createCapturingClient([scheduledAtMs]);
      const repo = new EvaluationRunClickHouseRepository(
        async () => client as never,
      );

      await repo.getByEvaluationId({
        tenantId: "project_test",
        evaluationId: "eval_recent",
      });

      const resolverQueries = queries.filter((q) =>
        q.query.includes("argMax(ScheduledAt"),
      );
      expect(resolverQueries).toHaveLength(1);
      expect(resolverQueries[0]!.query).toContain(
        "ScheduledAt >= fromUnixTimestamp64Milli({sinceMs:Int64})",
      );
      expect(resolverQueries[0]!.query_params).toMatchObject({
        sinceMs: expect.any(Number),
      });
    });
  });

  describe("when the windowed probe misses", () => {
    it("falls back to the unbounded seek so old evaluations stay resolvable", async () => {
      const oldScheduledAtMs = Date.now() - 200 * 24 * 60 * 60 * 1000;
      const { client, queries } = createCapturingClient([
        null,
        oldScheduledAtMs,
      ]);
      const repo = new EvaluationRunClickHouseRepository(
        async () => client as never,
      );

      await repo.getByEvaluationId({
        tenantId: "project_test",
        evaluationId: "eval_old",
      });

      const resolverQueries = queries.filter((q) =>
        q.query.includes("argMax(ScheduledAt"),
      );
      expect(resolverQueries).toHaveLength(2);
      expect(resolverQueries[0]!.query).toContain("ScheduledAt >=");
      expect(resolverQueries[1]!.query).not.toContain("ScheduledAt >=");
      // The resolved (old) ScheduledAt still reaches the heavy read as a
      // partition bound.
      const heavyRead = queries.find((q) => q.query.includes("PREWHERE"));
      expect(heavyRead?.query).toContain("t.ScheduledAt >=");
    });
  });
});
