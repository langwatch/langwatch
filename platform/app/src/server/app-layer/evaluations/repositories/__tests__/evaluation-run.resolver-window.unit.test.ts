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
    /**
     * The fallback used to carry no lower bound at all, which is what made this
     * the largest single source of cold-scan queries in production: nothing to
     * prune against, so every weekly partition including cold S3 was opened.
     * It is now floored at the tenant's retention horizon — still wide enough
     * to find any row that exists, because anything older is TTL'd away.
     */
    /** @scenario "A fallback read is floored at the tenant's retention horizon" */
    it("falls back to a retention-floored seek, not an unbounded one", async () => {
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
      expect(resolverQueries[1]!.query).toContain("ScheduledAt >=");

      // …and the floor is genuinely wider than the recent probe it follows,
      // or the second query would be a pointless repeat of the first.
      const probeSince = resolverQueries[0]!.query_params.sinceMs as number;
      const floorSince = resolverQueries[1]!.query_params.sinceMs as number;
      expect(floorSince).toBeLessThan(probeSince);

      // The resolved (old) ScheduledAt still reaches the heavy read as a
      // partition bound.
      const heavyRead = queries.find((q) => q.query.includes("PREWHERE"));
      expect(heavyRead?.query).toContain("t.ScheduledAt >=");
    });

    it("uses the tenant's own retention when a resolver is wired", async () => {
      const oldScheduledAtMs = Date.now() - 200 * 24 * 60 * 60 * 1000;
      const { client, queries } = createCapturingClient([
        null,
        oldScheduledAtMs,
      ]);
      const repo = new EvaluationRunClickHouseRepository(
        async () => client as never,
        { resolve: async () => ({ traces: 400 }) as never },
      );

      await repo.getByEvaluationId({
        tenantId: "project_test",
        evaluationId: "eval_old",
      });

      const resolverQueries = queries.filter((q) =>
        q.query.includes("argMax(ScheduledAt"),
      );
      const floorSince = resolverQueries[1]!.query_params.sinceMs as number;
      const dayMs = 24 * 60 * 60 * 1000;
      // 400 days of retention plus the margin, not the platform default.
      expect(Date.now() - floorSince).toBeGreaterThan(400 * dayMs);
      expect(Date.now() - floorSince).toBeLessThan(405 * dayMs);
    });
  });
});
