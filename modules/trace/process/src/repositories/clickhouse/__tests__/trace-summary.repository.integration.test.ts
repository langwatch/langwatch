// Integration tests for `findByTraceId` partition pruning
// (production schema: ReplacingMergeTree, partitioned by week, ordered by TenantId/TraceId)

import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TraceSummaryClickHouseRepository } from "../trace-summary.repository.ts";
import {
  startMigratedTraceClickHouse,
  testClickHouseConfigured,
} from "./support/clickhouse-endpoint.support.ts";

const tenantId = `test-tsumm-resolve-${nanoid()}`;
const presentTraceId = `trace-${nanoid()}`;
const base = Date.now() - 60 * 60 * 1000;

const clickHouseConfigured = testClickHouseConfigured();

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

beforeAll(async () => {
  if (!clickHouseConfigured) return;
  ch = await startMigratedTraceClickHouse();
  repo = TraceSummaryClickHouseRepository.create({
    resolveClient: async () => ch,
    defaultRetentionDays: 30,
  });

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
      query: "ALTER TABLE trace_summaries DELETE WHERE TenantId = {tenantId:String}",
      query_params: { tenantId },
    });
    await ch.close();
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
    repo: TraceSummaryClickHouseRepository.create({
      resolveClient: async () => recordingClient,
      defaultRetentionDays: 30,
    }),
    queries,
  };
}

describe.skipIf(!clickHouseConfigured)("TraceSummaryClickHouseRepository.findByTraceId (integration)", () => {
  it("returns the trace when no occurredAtMs hint is passed", async () => {
    const result = await repo.findByTraceId({ tenantId, traceId: presentTraceId });

    expect(result).not.toBeNull();
    expect(result?.traceId).toBe(presentTraceId);
  });

  it("resolves OccurredAt and bounds the heavy read for a hint-less call", async () => {
    const { repo: rec, queries } = recordingRepo();

    const result = await rec.findByTraceId({ tenantId, traceId: presentTraceId });

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

    const result = await rec.findByTraceId({ tenantId, traceId: `missing-${nanoid()}` });

    expect(result).toBeNull();
    // The light resolve confirms absence; the heavy unbounded read is never
    // issued (this is the win for the not-found case).
    expect(queries.some((q) => q.includes("min(OccurredAt)"))).toBe(true);
    expect(queries.some((q) => q.includes("ComputedInput"))).toBe(false);
  });

  // The OccurredAt=0 sentinel fallback is covered deterministically in
  // trace-summary.clickhouse.repository.unit.test.ts, not here: round-tripping
  // an epoch timestamp through a shared CI ClickHouse container proved flaky.
});
