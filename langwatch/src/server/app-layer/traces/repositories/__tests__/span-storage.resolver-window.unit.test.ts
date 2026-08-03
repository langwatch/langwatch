/**
 * @vitest-environment node
 *
 * Pins the two-phase partition-hint resolver behind the hint-less span reads:
 * the trace OccurredAt seek on `trace_summaries` must probe the recent window
 * first and only fall back to an unbounded scan on a miss. Without the bound
 * the resolver walks every weekly partition incl. cold S3 (measured ~0.9s avg
 * during the 2026-08-03 queue saturation, on traces minutes old).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SpanStorageClickHouseRepository } from "../span-storage.clickhouse.repository";

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
      if (args.query.includes("min(OccurredAt)")) {
        const value = resolverResponses[resolverCall] ?? null;
        resolverCall += 1;
        return { json: async () => [{ occurredAtMs: value }] };
      }
      return { json: async () => [] };
    }),
  };
  return { client, queries };
}

describe("SpanStorageClickHouseRepository trace OccurredAt resolver", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-03T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("when the trace is recent", () => {
    it("resolves from the windowed probe and never scans unbounded", async () => {
      const occurredAtMs = Date.now() - 60_000;
      const { client, queries } = createCapturingClient([occurredAtMs]);
      const repo = new SpanStorageClickHouseRepository(
        async () => client as never,
      );

      await repo.getSpanByIds({
        tenantId: "project_test",
        traceId: "trace_recent",
        spanId: "span_1",
      });

      const resolverQueries = queries.filter((q) =>
        q.query.includes("min(OccurredAt)"),
      );
      expect(resolverQueries).toHaveLength(1);
      expect(resolverQueries[0]!.query).toContain(
        "OccurredAt >= fromUnixTimestamp64Milli({sinceMs:Int64})",
      );
    });
  });

  describe("when the windowed probe misses", () => {
    it("falls back to the unbounded seek so old traces stay resolvable", async () => {
      const { client, queries } = createCapturingClient([null, null]);
      const repo = new SpanStorageClickHouseRepository(
        async () => client as never,
      );

      await repo.getSpanByIds({
        tenantId: "project_test",
        traceId: "trace_old",
        spanId: "span_1",
      });

      const resolverQueries = queries.filter((q) =>
        q.query.includes("min(OccurredAt)"),
      );
      expect(resolverQueries).toHaveLength(2);
      expect(resolverQueries[0]!.query).toContain("OccurredAt >=");
      expect(resolverQueries[1]!.query).not.toContain("OccurredAt >=");
    });
  });
});
