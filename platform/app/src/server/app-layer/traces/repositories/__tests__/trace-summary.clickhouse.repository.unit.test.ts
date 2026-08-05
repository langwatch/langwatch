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
import type { ClickHouseClient } from "@clickhouse/client";
import { describe, expect, it, vi } from "vitest";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import {
  TRACE_SUMMARY_PROJECTION_VERSION_LATEST,
  TRACE_SUMMARY_PROJECTION_VERSION_PRE_STORAGE_ANCHOR,
} from "~/server/event-sourcing/pipelines/trace-processing/schemas/constants";
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
    query: vi.fn(async ({ query }: { query: string }) => {
      queries.push(query);
      return { json: async () => responder(query) };
    }),
  } as unknown as ClickHouseClient;
  return {
    repo: new TraceSummaryClickHouseRepository(async () => client),
    queries,
  };
}

const isResolve = (sql: string) => sql.includes("count() AS rowCount");

describe("TraceSummaryClickHouseRepository.findByTraceId (unit)", () => {
  it("decodes the post-split timing baseline separately from its storage anchor", async () => {
    const { repo } = makeRepo(() => [
      {
        ...heavyRow,
        Version: TRACE_SUMMARY_PROJECTION_VERSION_LATEST,
        OccurredAt: 1_760_000_060_000,
        EarliestSpanStartMs: 1_760_000_055_000,
      },
    ]);

    const result = await repo.findByTraceId("tenant-1", "t1", {
      window: { fromMs: 1_760_000_000_000, toMs: 1_760_000_100_000 },
    });

    expect(result?.storageAnchorMs).toBe(1_760_000_060_000);
    expect(result?.occurredAt).toBe(1_760_000_055_000);
  });

  it("adopts a pre-split OccurredAt as both anchor and timing baseline", async () => {
    const { repo } = makeRepo(() => [
      {
        ...heavyRow,
        Version: TRACE_SUMMARY_PROJECTION_VERSION_PRE_STORAGE_ANCHOR,
        OccurredAt: 1_760_000_055_000,
        EarliestSpanStartMs: 0,
      },
    ]);

    const result = await repo.findByTraceId("tenant-1", "t1", {
      window: { fromMs: 1_760_000_000_000, toMs: 1_760_000_100_000 },
    });

    expect(result?.storageAnchorMs).toBe(1_760_000_055_000);
    expect(result?.occurredAt).toBe(1_760_000_055_000);
  });

  it("writes the frozen anchor and timing baseline to separate columns", async () => {
    const insert = vi.fn().mockResolvedValue(undefined);
    const client = { insert } as unknown as ClickHouseClient;
    const repo = new TraceSummaryClickHouseRepository(async () => client);
    const anchorMs = 1_760_000_060_000;
    const baselineMs = 1_760_000_055_000;

    await repo.upsert(
      {
        traceId: "t1",
        storageAnchorMs: anchorMs,
        occurredAt: baselineMs,
        createdAt: anchorMs,
        updatedAt: anchorMs,
        LastEventOccurredAt: anchorMs,
        attributes: {},
        annotationIds: [],
        models: [],
      } as unknown as TraceSummaryData,
      "tenant-1",
    );

    const record = insert.mock.calls[0]?.[0]?.values[0];
    expect(record.OccurredAt).toEqual(new Date(anchorMs));
    expect(record.EarliestSpanStartMs).toBe(baselineMs);
  });

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
