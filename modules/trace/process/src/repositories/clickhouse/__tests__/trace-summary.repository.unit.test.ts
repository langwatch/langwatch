// Unit tests for `findByTraceId` OccurredAt-resolution branch selection.
// Three paths: no row -> null; positive ms -> partition-pruned; 0 -> legacy fallback
import { aggregateProof, ownProof } from "@langwatch/authorization/testing";
import type { QueryRequest } from "@langwatch/clickhouse-client";
import { clickHouseClientDouble } from "@langwatch/test-harness/client-doubles/clickhouse";
import type { TraceSummaryData } from "@langwatch/trace-contract";
import {
  TRACE_SUMMARY_PROJECTION_VERSION_LATEST,
  TRACE_SUMMARY_PROJECTION_VERSION_PRE_STORAGE_ANCHOR,
} from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import { createFoldState } from "../../../eventing/__tests__/trace-subscriber.fixtures.ts";
import { AuthorizedTraceReadsRepository } from "../clickhouse.trace-member-client.repository.ts";
import { TraceSummaryClickHouseRepository } from "../trace-summary.repository.ts";

const authorization = ownProof({ projectId: "tenant-1", now: Date.now() });

/** A whole `findByTraceId` row, as ClickHouse's JSON writes it (64-bit integers as strings). */
const heavyRow = {
  ProjectionId: "p1",
  TenantId: "tenant-1",
  TraceId: "t1",
  Version: "v1",
  Attributes: {},
  OccurredAt: "0",
  EarliestSpanStartMs: "0",
  CreatedAt: "0",
  UpdatedAt: "0",
  ComputedIOSchemaVersion: "v1",
  ComputedInput: "log-input",
  ComputedOutput: "log-output",
  TimeToFirstTokenMs: null,
  TimeToLastTokenMs: null,
  TotalDurationMs: "0",
  TokensPerSecond: null,
  SpanCount: 0,
  ContainsErrorStatus: false,
  ContainsOKStatus: false,
  ErrorMessage: null,
  Models: [],
  TotalCost: null,
  NonBilledCost: null,
  TokensEstimated: false,
  TotalPromptTokenCount: null,
  TotalCompletionTokenCount: null,
  OutputFromRootSpan: false,
  OutputSpanEndTimeMs: "0",
  BlockedByGuardrail: false,
  RootSpanType: null,
  ContainsAi: false,
  ContainsPrompt: false,
  SelectedPromptId: null,
  SelectedPromptSpanId: null,
  LastUsedPromptId: null,
  LastUsedPromptVersionNumber: null,
  LastUsedPromptVersionId: null,
  LastUsedPromptSpanId: null,
  TopicId: null,
  SubTopicId: null,
  AnnotationIds: [],
  HasAnnotation: null,
  TraceName: "",
};

/**
 * The repository over a recording reader: every statement goes through the proof's fence
 * first, so `sent` holds what ClickHouse would be asked, the tenant set included.
 */
function makeRepo(responder: (sql: string) => unknown[]) {
  const queries: string[] = [];
  const sent: QueryRequest[] = [];
  const reads = AuthorizedTraceReadsRepository.create({
    clickhouse: {
      query: async <Row>(request: QueryRequest) => {
        queries.push(request.sql);
        sent.push(request);
        return { rows: responder(request.sql) as Row[] };
      },
    },
  });
  const resolveClient = vi.fn(async () => {
    throw new Error("a read must not resolve a tenant's own client");
  });
  return {
    repo: TraceSummaryClickHouseRepository.create({ resolveClient, reads }),
    reads,
    queries,
    sent,
    resolveClient,
  };
}

const isResolve = (sql: string) => sql.includes("count() AS rowCount");

describe("TraceSummaryClickHouseRepository.findByTraceId (tenancy)", () => {
  describe("given a proof that reads one project", () => {
    it("reads through the proof's fence and never resolves a tenant's client", async () => {
      const { repo, sent, resolveClient } = makeRepo((sql) =>
        isResolve(sql) ? [{ rowCount: "1", occurredAtMs: "0" }] : [heavyRow],
      );

      await repo.findByTraceId({ authorization, traceId: "t1" });

      expect(resolveClient).not.toHaveBeenCalled();
      expect(sent.length).toBeGreaterThan(0);
      for (const request of sent) {
        expect(request.tenantId).toBe("tenant-1");
        expect(request.params).not.toHaveProperty("tenantId");
        expect(request.params?.tenantScope_all).toEqual(["tenant-1"]);
        expect(request.params?.traceId).toBe("t1");
        expect(request.sql).not.toContain("{tenantId:String}");
      }
    });

    it("names the tenant the summary was read from", async () => {
      const { repo } = makeRepo((sql) =>
        isResolve(sql) ? [{ rowCount: "1", occurredAtMs: "0" }] : [heavyRow],
      );

      const result = await repo.findByTraceId({ authorization, traceId: "t1" });

      expect(result?.tenantId).toBe("tenant-1");
    });
  });

  describe("given a proof that reads an aggregate's members", () => {
    const aggregate = aggregateProof({
      projectId: "aggregate",
      members: [{ projectId: "member-a", from: 1_000, until: 2_000 }],
      now: Date.now(),
    });

    it("windows the dedup subquery and takes the tenant set alone in the outer scope", async () => {
      const { repo, queries } = makeRepo(() => [heavyRow]);

      await repo.findByTraceId({
        authorization: aggregate,
        traceId: "t1",
        window: { fromMs: 1_000, toMs: 2_000 },
      });

      const heavy = queries.find((query) => query.includes("ComputedInput"))!;
      // The outer scope projects `OccurredAt` as an integer alias; the window
      // must name the stored column, which only the subquery reads.
      const [outer, subquery] = heavy.split("(t.TenantId, t.TraceId, t.UpdatedAt) IN (");
      expect(outer).toContain("TenantId IN ({tenantScope_all:Array(String)})");
      expect(outer).not.toContain("has({tenantScope_ids");
      expect(subquery).toContain("has({tenantScope_ids");
    });

    it("picks the same row on every read when two members hold the trace id", async () => {
      const { repo, queries } = makeRepo(() => [heavyRow]);

      await repo.findByTraceId({
        authorization: aggregate,
        traceId: "t1",
        window: { fromMs: 1_000, toMs: 2_000 },
      });

      expect(queries[0]).toMatch(/ORDER BY t\.TenantId ASC\s+LIMIT 1/);
    });
  });
});

describe("TraceSummaryClickHouseRepository.findByTraceId (unit)", () => {
  it("issues an unbounded heavy read for the OccurredAt=0 sentinel", async () => {
    const { repo, queries } = makeRepo((sql) =>
      isResolve(sql) ? [{ rowCount: "1", occurredAtMs: "0" }] : [heavyRow],
    );

    const result = await repo.findByTraceId({ authorization, traceId: "t1" });

    expect(result).not.toBeNull();
    expect(result?.traceId).toBe("t1");
    const heavy = queries.find((q) => q.includes("ComputedInput"));
    expect(heavy).toBeDefined();
    expect(heavy!).not.toContain("OccurredAt >= fromUnixTimestamp64Milli({fromMs");
  });

  it("issues a bounded heavy read when the resolve returns a positive OccurredAt", async () => {
    const { repo, queries } = makeRepo((sql) =>
      isResolve(sql) ? [{ rowCount: "1", occurredAtMs: String(Date.now()) }] : [heavyRow],
    );

    const result = await repo.findByTraceId({ authorization, traceId: "t1" });

    expect(result?.traceId).toBe("t1");
    const heavy = queries.find((q) => q.includes("ComputedInput"));
    expect(heavy).toBeDefined();
    expect(heavy!).toContain("OccurredAt >= fromUnixTimestamp64Milli({fromMs");
  });

  it("skips the heavy read and returns null when the resolve finds no row", async () => {
    const { repo, queries } = makeRepo((sql) =>
      isResolve(sql) ? [{ rowCount: "0", occurredAtMs: null }] : [heavyRow],
    );

    const result = await repo.findByTraceId({ authorization, traceId: "missing" });

    expect(result).toBeNull();
    expect(queries.some((q) => q.includes("ComputedInput"))).toBe(false);
  });

  it("applies an explicit window verbatim as one bounded read", async () => {
    const { repo, queries } = makeRepo(() => [heavyRow]);

    const result = await repo.findByTraceId({
      authorization,
      traceId: "t1",
      window: { fromMs: 1_000, toMs: 2_000 },
    });

    expect(result?.traceId).toBe("t1");
    expect(queries).toHaveLength(1);
    expect(queries[0]!).toContain("OccurredAt >= fromUnixTimestamp64Milli({fromMs");
  });

  it("returns null on an explicit-window miss without a recovery ladder of its own", async () => {
    // The window caller (the fold executor) owns the unwindowed retry — a
    // second recovery here would re-run the resolve seek on a result the
    // executor is about to re-read anyway.
    const { repo, queries } = makeRepo(() => []);

    const result = await repo.findByTraceId({
      authorization,
      traceId: "t1",
      window: { fromMs: 1_000, toMs: 2_000 },
    });

    expect(result).toBeNull();
    expect(queries).toHaveLength(1);
    expect(queries.some((q) => isResolve(q))).toBe(false);
  });
});

// Storage-anchor split (ADR-087): OccurredAt = partition/TTL, EarliestSpanStartMs = baseline
// Version-gated decode handles pre/post-split row ambiguity
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

      const result = await repo.findByTraceId({
        authorization,
        traceId: "t1",
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

      const result = await repo.findByTraceId({
        authorization,
        traceId: "t1",
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

      const result = await repo.findByTraceId({
        authorization,
        traceId: "t1",
        window: { fromMs: anchorMs - 1_000, toMs: anchorMs + 1_000 },
      });

      expect(result?.occurredAt).toBe(baselineMs);
      expect(result?.storageAnchorMs).toBe(anchorMs);
    });
  });

  describe("when a state is written back", () => {
    function makeInsertRepo() {
      const insert = vi.fn().mockResolvedValue(undefined);
      const client = clickHouseClientDouble({ insert });
      return {
        repo: TraceSummaryClickHouseRepository.create({
          resolveClient: async () => client,
          reads: makeRepo(() => []).reads,
        }),
        insert,
      };
    }

    const stateWith = (over: Partial<TraceSummaryData>): TraceSummaryData =>
      createFoldState({
        traceId: "t1",
        attributes: {},
        annotationIds: [],
        models: [],
        createdAt: anchorMs,
        updatedAt: anchorMs,
        LastEventOccurredAt: anchorMs,
        ...over,
      });

    it("puts the frozen anchor in OccurredAt and the baseline in its own column", async () => {
      const { repo, insert } = makeInsertRepo();

      await repo.upsert(
        stateWith({ storageAnchorMs: anchorMs, occurredAt: baselineMs }),
        "tenant-1",
        30,
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
        30,
      );

      const record = insert.mock.calls[0]?.[0]?.values[0];
      expect(record.OccurredAt.getTime()).toBeGreaterThanOrEqual(before);
    });

    it("re-anchors a committed row whose anchor sits implausibly far ahead", async () => {
      const { repo, insert } = makeInsertRepo();
      const farFutureMs = Date.now() + 365 * 24 * 60 * 60 * 1000;

      await repo.upsert(stateWith({ storageAnchorMs: farFutureMs, occurredAt: 0 }), "tenant-1", 30);

      // Deliberate: such a row was filed in a future partition with a TTL
      // deadline to match and would have outlived its tenant's retention. The
      // chain then takes the next validated candidate, the state's own
      // createdAt, rather than jumping straight to fold time.
      const record = insert.mock.calls[0]?.[0]?.values[0];
      expect(record.OccurredAt).toEqual(new Date(anchorMs));
    });
  });
});
