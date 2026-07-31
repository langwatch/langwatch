/**
 * Unit tests for `findByTraceId`'s OccurredAt-resolution branch selection.
 *
 * The read path first resolves the trace's OccurredAt from a cheap sort-key
 * seek, then chooses how to issue the heavy single-trace read:
 *   - resolve finds no row        -> return null, never issue the heavy read
 *   - resolve yields a positive ms -> bounded heavy read (partition-pruned)
 *   - resolve yields the 0 sentinel -> unbounded heavy read (legacy fallback)
 *
 * These branches are exercised here with a mocked client so they never depend
 * on how a real ClickHouse container round-trips an epoch timestamp; the
 * companion integration test covers the real-CH partition-pruning behavior.
 */
import { describe, expect, it, vi } from "vitest";
import type { TenantClickHouseClient } from "~/server/app-layer/clients/clickhouse/tenant-client";
import { TraceSummaryClickHouseRepository } from "../trace-summary.clickhouse.repository";

const heavyRow = {
  ProjectionId: "p1",
  TenantId: "tenant-1",
  TraceId: "t1",
  SpanCount: 0,
  ComputedInput: "log-input",
  ComputedOutput: "log-output",
  ComputedIOSchemaVersion: "v1",
  TotalDurationMs: "0",
  Models: [],
  OutputSpanEndTimeMs: "0",
};

function makeRepo(responder: (sql: string) => unknown[]) {
  const queries: string[] = [];
  const client = {
    query: vi.fn(async ({ sql }: { sql: string }) => {
      queries.push(sql);
      return responder(sql);
    }),
  } as unknown as TenantClickHouseClient;
  return {
    repo: new TraceSummaryClickHouseRepository(async () => client),
    queries,
  };
}

const isResolve = (sql: string) => sql.includes("count() AS rowCount");

describe("TraceSummaryClickHouseRepository.findByTraceId (unit)", () => {
  it("issues an unbounded heavy read for the OccurredAt=0 sentinel", async () => {
    const { repo, queries } = makeRepo((sql) =>
      isResolve(sql) ? [{ rowCount: "1", occurredAtMs: "0" }] : [heavyRow],
    );

    const result = await repo.findByTraceId("tenant-1", "t1");

    expect(result).not.toBeNull();
    expect(result?.traceId).toBe("t1");
    const heavy = queries.find((q) => q.includes("ComputedInput"));
    expect(heavy).toBeDefined();
    expect(heavy!).not.toContain("OccurredAt >=");
  });

  it("issues a bounded heavy read when the resolve returns a positive OccurredAt", async () => {
    const { repo, queries } = makeRepo((sql) =>
      isResolve(sql)
        ? [{ rowCount: "1", occurredAtMs: String(Date.now()) }]
        : [heavyRow],
    );

    const result = await repo.findByTraceId("tenant-1", "t1");

    expect(result?.traceId).toBe("t1");
    const heavy = queries.find((q) => q.includes("ComputedInput"));
    expect(heavy).toBeDefined();
    expect(heavy!).toContain("OccurredAt >=");
  });

  it("skips the heavy read and returns null when the resolve finds no row", async () => {
    const { repo, queries } = makeRepo((sql) =>
      isResolve(sql) ? [{ rowCount: "0", occurredAtMs: null }] : [heavyRow],
    );

    const result = await repo.findByTraceId("tenant-1", "missing");

    expect(result).toBeNull();
    expect(queries.some((q) => q.includes("ComputedInput"))).toBe(false);
  });

  it("applies an explicit window verbatim as one bounded read", async () => {
    const { repo, queries } = makeRepo(() => [heavyRow]);

    const result = await repo.findByTraceId("tenant-1", "t1", {
      window: { fromMs: 1_000, toMs: 2_000 },
    });

    expect(result?.traceId).toBe("t1");
    expect(queries).toHaveLength(1);
    expect(queries[0]!).toContain("OccurredAt >=");
  });

  it("returns null on an explicit-window miss without a recovery ladder of its own", async () => {
    // The window caller (the fold executor) owns the unwindowed retry — a
    // second recovery here would re-run the resolve seek on a result the
    // executor is about to re-read anyway.
    const { repo, queries } = makeRepo(() => []);

    const result = await repo.findByTraceId("tenant-1", "t1", {
      window: { fromMs: 1_000, toMs: 2_000 },
    });

    expect(result).toBeNull();
    expect(queries).toHaveLength(1);
    expect(queries.some((q) => isResolve(q))).toBe(false);
  });
});
