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
      isResolve(sql) ? [{ rowCount: "1", occurredAtMs: String(Date.now()) }] : [heavyRow],
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

/**
 * The storage-anchor split (ADR-087, migration 00072). `OccurredAt` is the
 * frozen partition / TTL address; `EarliestSpanStartMs` is the span timing
 * baseline it used to double as. Once BOTH shapes exist,
 * `EarliestSpanStartMs = 0` is ambiguous between "pre-split row, the baseline
 * lives in OccurredAt" and "post-split log-only trace, the baseline genuinely is
 * 0", and only the projection stamp separates them — so the decode is
 * version-gated and these tests are about that gate.
 */
describe("given the trace-summary row carries a storage anchor", () => {
  const anchorMs = 1_760_000_060_000;
  const baselineMs = 1_760_000_055_000;

  describe("when the row was written before filing time was held separately", () => {
    /** @scenario "A summary written before the change reports the same start it always did" */
    it("adopts its one OccurredAt as both the anchor and the timing baseline", async () => {
      const { repo } = makeRepo(() => [
        {
          ...heavyRow,
          Version: TRACE_SUMMARY_PROJECTION_VERSION_PRE_STORAGE_ANCHOR,
          OccurredAt: baselineMs,
          // The column did not exist when this row was written, so ClickHouse
          // reads it back as its DEFAULT 0. Decoding that as the baseline would
          // reset the trace's duration to start from its next span.
          EarliestSpanStartMs: 0,
        },
      ]);

      const result = await repo.findByTraceId("tenant-1", "t1", {
        window: { fromMs: baselineMs - 1_000, toMs: baselineMs + 1_000 },
      });

      expect(result?.occurredAt).toBe(baselineMs);
      expect(result?.storageAnchorMs).toBe(baselineMs);
    });
  });

  describe("when the row was written after filing time was held separately", () => {
    /** @scenario "A summary written after the change reports its spans' start, not its filing time" */
    it("reads the baseline from its own column and never from the anchor", async () => {
      const { repo } = makeRepo(() => [
        {
          ...heavyRow,
          Version: TRACE_SUMMARY_PROJECTION_VERSION_LATEST,
          OccurredAt: anchorMs,
          EarliestSpanStartMs: baselineMs,
        },
      ]);

      const result = await repo.findByTraceId("tenant-1", "t1", {
        window: { fromMs: anchorMs - 1_000, toMs: anchorMs + 1_000 },
      });

      expect(result?.occurredAt).toBe(baselineMs);
      expect(result?.storageAnchorMs).toBe(anchorMs);
    });

    /** @scenario "A summary written after the change reports its spans' start, not its filing time" */
    it("keeps reading the baseline from its own column after a later version bump", async () => {
      const { repo } = makeRepo(() => [
        {
          ...heavyRow,
          // A stamp this branch does not know about, standing in for the next
          // ordinary schema bump. It is still post-split, so the anchor must not
          // be handed back as the trace's start.
          Version: "2027-03-01",
          OccurredAt: anchorMs,
          EarliestSpanStartMs: baselineMs,
        },
      ]);

      const result = await repo.findByTraceId("tenant-1", "t1", {
        window: { fromMs: anchorMs - 1_000, toMs: anchorMs + 1_000 },
      });

      expect(result?.occurredAt).toBe(baselineMs);
      expect(result?.storageAnchorMs).toBe(anchorMs);
    });
  });

  describe("when a state is written back", () => {
    function makeInsertRepo() {
      const insert = vi.fn().mockResolvedValue(undefined);
      const client = { insert } as unknown as ClickHouseClient;
      return {
        repo: new TraceSummaryClickHouseRepository(async () => client),
        insert,
      };
    }

    const stateWith = (over: Partial<TraceSummaryData>) =>
      ({
        traceId: "t1",
        attributes: {},
        annotationIds: [],
        models: [],
        createdAt: anchorMs,
        updatedAt: anchorMs,
        LastEventOccurredAt: anchorMs,
        ...over,
      }) as unknown as TraceSummaryData;

    it("puts the frozen anchor in OccurredAt and the baseline in its own column", async () => {
      const { repo, insert } = makeInsertRepo();

      await repo.upsert(
        stateWith({ storageAnchorMs: anchorMs, occurredAt: baselineMs }),
        "tenant-1",
      );

      const record = insert.mock.calls[0]?.[0]?.values[0];
      expect(record.OccurredAt).toEqual(new Date(anchorMs));
      expect(record.EarliestSpanStartMs).toBe(baselineMs);
    });

    it("never writes the epoch into the partition column, even with nothing to anchor on", async () => {
      const { repo, insert } = makeInsertRepo();
      const before = Date.now();

      // A state nothing could anchor: no frozen anchor, no span baseline, and a
      // createdAt that failed to parse (parseClickHouseDateTimeMs returns 0).
      await repo.upsert(
        stateWith({ storageAnchorMs: 0, occurredAt: 0, createdAt: 0 }),
        "tenant-1",
      );

      const record = insert.mock.calls[0]?.[0]?.values[0];
      expect(record.OccurredAt.getTime()).toBeGreaterThanOrEqual(before);
    });

    it("re-anchors a committed row whose anchor sits implausibly far ahead", async () => {
      const { repo, insert } = makeInsertRepo();
      const farFutureMs = Date.now() + 365 * 24 * 60 * 60 * 1000;

      await repo.upsert(
        stateWith({ storageAnchorMs: farFutureMs, occurredAt: 0 }),
        "tenant-1",
      );

      // Deliberate: such a row was filed in a future partition with a TTL
      // deadline to match and would have outlived its tenant's retention. The
      // chain then takes the next validated candidate, the state's own
      // createdAt, rather than jumping straight to fold time.
      const record = insert.mock.calls[0]?.[0]?.values[0];
      expect(record.OccurredAt).toEqual(new Date(anchorMs));
    });
  });
});
