/**
 * Integration tests for `findByTraceId` partition pruning on a real ClickHouse
 * testcontainer (production `trace_summaries` schema:
 * `ReplacingMergeTree(UpdatedAt)`, `PARTITION BY toYearWeek(OccurredAt)`,
 * `ORDER BY (TenantId, TraceId)`).
 *
 * The heavy single-trace read (ComputedInput / ComputedOutput / Attributes)
 * only prunes partitions when an OccurredAt predicate is present. Callers that
 * don't thread an `occurredAtMs` hint used to fall back to scanning every
 * weekly partition incl. cold S3; the reader now resolves OccurredAt from a
 * cheap sort-key seek and bounds the read — and skips the heavy read entirely
 * for a trace that doesn't exist.
 */

import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { startTestContainers } from "../../../../event-sourcing/__tests__/integration/testContainers";
import { TraceSummaryClickHouseRepository } from "../trace-summary.clickhouse.repository";

const tenantId = `test-tsumm-resolve-${nanoid()}`;
const presentTraceId = `trace-${nanoid()}`;
const base = Date.now() - 60 * 60 * 1000;

let ch: ClickHouseClient;
let repo: TraceSummaryClickHouseRepository;

function makeRow(traceId: string, occurredAtMs: number) {
  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: tenantId,
    TraceId: traceId,
    Version: "v1",
    Attributes: {},
    OccurredAt: new Date(occurredAtMs),
    CreatedAt: new Date(occurredAtMs),
    UpdatedAt: new Date(occurredAtMs),
    ComputedIOSchemaVersion: "v1",
    ComputedInput: "input-heavy",
    ComputedOutput: "output-heavy",
    TimeToFirstTokenMs: null,
    TimeToLastTokenMs: null,
    TotalDurationMs: 100,
    TokensPerSecond: null,
    SpanCount: 1,
    ContainsErrorStatus: false,
    ContainsOKStatus: true,
    ErrorMessage: null,
    Models: [],
    TotalCost: null,
    TokensEstimated: false,
    TotalPromptTokenCount: null,
    TotalCompletionTokenCount: null,
    OutputFromRootSpan: false,
    OutputSpanEndTimeMs: 0,
    BlockedByGuardrail: false,
    TraceName: "trace",
    RootSpanType: "",
    ContainsAi: false,
    ContainsPrompt: false,
    AnnotationIds: [],
    LastEventOccurredAt: new Date(occurredAtMs),
    TopicId: null,
    SubTopicId: null,
  };
}

function makeLogsOnlyRow(traceId: string) {
  return {
    ...makeRow(traceId, 0),
    SpanCount: 0,
    Attributes: { "langwatch.reserved.log_record_count": "1" },
    ComputedInput: "log-input",
    ComputedOutput: "log-output",
  };
}

beforeAll(async () => {
  const containers = await startTestContainers();
  ch = containers.clickHouseClient;
  repo = new TraceSummaryClickHouseRepository(async () => ch);

  await ch.insert({
    table: "trace_summaries",
    values: [makeRow(presentTraceId, base)],
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
}, 120_000);

afterAll(async () => {
  if (ch) {
    await ch.exec({
      query:
        "ALTER TABLE trace_summaries DELETE WHERE TenantId = {tenantId:String}",
      query_params: { tenantId },
    });
  }
});

function recordingRepo(): {
  repo: TraceSummaryClickHouseRepository;
  queries: string[];
} {
  const queries: string[] = [];
  const recordingClient = new Proxy(ch, {
    get(target, prop, receiver) {
      if (prop === "query") {
        return (args: { query: string; query_params?: unknown }) => {
          if (args.query.includes("trace_summaries")) {
            queries.push(args.query);
          }
          return (target as ClickHouseClient).query(args as never);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as ClickHouseClient;
  return {
    repo: new TraceSummaryClickHouseRepository(async () => recordingClient),
    queries,
  };
}

describe("TraceSummaryClickHouseRepository.findByTraceId (integration)", () => {
  it("returns the trace when no occurredAtMs hint is passed", async () => {
    const result = await repo.findByTraceId(tenantId, presentTraceId);

    expect(result).not.toBeNull();
    expect(result?.traceId).toBe(presentTraceId);
  });

  it("resolves OccurredAt and bounds the heavy read for a hint-less call", async () => {
    const { repo: rec, queries } = recordingRepo();

    const result = await rec.findByTraceId(tenantId, presentTraceId);

    expect(result?.traceId).toBe(presentTraceId);
    // One cheap resolve (min(OccurredAt)) + the heavy read, and the heavy read
    // is partition-bounded on OccurredAt rather than unbounded.
    const resolveQuery = queries.find((q) => q.includes("min(OccurredAt)"));
    const heavyQuery = queries.find((q) => q.includes("ComputedInput"));
    expect(resolveQuery).toBeDefined();
    expect(heavyQuery).toBeDefined();
    expect(heavyQuery!).toContain("OccurredAt >=");
  });

  it("skips the heavy read entirely for a trace that does not exist", async () => {
    const { repo: rec, queries } = recordingRepo();

    const result = await rec.findByTraceId(tenantId, `missing-${nanoid()}`);

    expect(result).toBeNull();
    // The light resolve confirms absence; the heavy unbounded read is never
    // issued (this is the win for the not-found case).
    expect(queries.some((q) => q.includes("min(OccurredAt)"))).toBe(true);
    expect(queries.some((q) => q.includes("ComputedInput"))).toBe(false);
  });

  it("still returns a logs-only trace that carries the OccurredAt=0 sentinel", async () => {
    // Insert a dedicated sentinel row for this test rather than sharing the
    // beforeAll row, so the assertion never depends on cross-test container
    // state (the epoch partition is easy to disturb under a busy CI shard).
    const sentinelTraceId = `logs-only-sentinel-${nanoid()}`;
    await ch.insert({
      table: "trace_summaries",
      values: [makeLogsOnlyRow(sentinelTraceId)],
      format: "JSONEachRow",
      clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
    });

    // On a loaded CI shard the freshly-inserted row can lag the insert ack;
    // wait until it is queryable so the read path sees it deterministically
    // (this is a test-visibility guard, not a product concern).
    await vi.waitFor(
      async () => {
        const check = await ch.query({
          query:
            "SELECT count() AS c FROM trace_summaries WHERE TenantId = {tenantId:String} AND TraceId = {traceId:String}",
          query_params: { tenantId, traceId: sentinelTraceId },
          format: "JSONEachRow",
        });
        const [row] = (await check.json()) as Array<{ c: string | number }>;
        if (Number(row?.c ?? 0) < 1) throw new Error("sentinel row not visible");
      },
      { timeout: 10_000, interval: 100 },
    );

    const { repo: rec, queries } = recordingRepo();

    const result = await rec.findByTraceId(tenantId, sentinelTraceId);

    expect(result).not.toBeNull();
    expect(result?.traceId).toBe(sentinelTraceId);
    expect(result?.spanCount).toBe(0);
    expect(result?.computedInput).toBe("log-input");
    const resolveQuery = queries.find((q) => q.includes("count() AS rowCount"));
    const heavyQuery = queries.find((q) => q.includes("ComputedInput"));
    expect(resolveQuery).toBeDefined();
    expect(heavyQuery).toBeDefined();
    expect(heavyQuery!).not.toContain("OccurredAt >=");
  });
});
