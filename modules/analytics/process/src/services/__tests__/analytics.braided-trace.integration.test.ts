/**
 * Analytics shows only the project's own spans (ADR-185 §5), against production schema: a trace
 * both projects hold, read through the analytics service the panels and Langy's `analytics query`
 * call. Spec: modules/trace/specs/braided-spans.feature; the other six surfaces: modules/trace.
 */
import type { ClickHouseClient } from "@clickhouse/client";
import type { AnalyticsTimeseriesInput } from "@langwatch/analytics-contract";
import { InProcessTenantStatementLimiter } from "@langwatch/limiter";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  deleteMigratedTenantRows,
  startMigratedClickHouse,
} from "../../__tests__/migrated-clickhouse.harness.ts";
import { analyticsTestAuthz } from "../../repositories/__tests__/analytics-proof.fixture.ts";
import { NullAnalyticsEvaluationRepository } from "../../repositories/analytics-persistence.repository.ts";
import { clickHouseQueryClientOver } from "../../repositories/clickhouse/__tests__/support/clickhouse-query-client.support.ts";
import { ClickHouseAnalyticsRepository } from "../../repositories/clickhouse/clickhouse.analytics.repository.ts";
import { AnalyticsService } from "../analytics.service.ts";

const run = nanoid();
const reader = `test-analytics-reader-${run}`;
const owner = `test-analytics-owner-${run}`;
const traceId = `trace-analytics-${run}`;
const T0 = Date.now() - 60 * 60 * 1000;
const SEEDED_TABLES = ["trace_summaries", "stored_spans"] as const;

let ch: ClickHouseClient;
let analytics: AnalyticsService;

function summaryRow({ tenantId, cost }: { tenantId: string; cost: number }) {
  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: tenantId,
    TraceId: traceId,
    Version: "v1",
    Attributes: {},
    OccurredAt: new Date(T0),
    CreatedAt: new Date(T0),
    UpdatedAt: new Date(T0),
    ComputedIOSchemaVersion: "v1",
    ComputedInput: "input",
    ComputedOutput: "output",
    TotalDurationMs: 100,
    SpanCount: 1,
    TotalCost: cost,
    ContainsErrorStatus: false,
    ContainsOKStatus: true,
    Models: [],
    TokensEstimated: false,
    OutputFromRootSpan: false,
    OutputSpanEndTimeMs: 0,
    BlockedByGuardrail: false,
    TraceName: "",
    RootSpanType: "",
    ContainsAi: false,
    ContainsPrompt: false,
    AnnotationIds: [],
    LastEventOccurredAt: new Date(T0),
  };
}

function spanRow({ tenantId, spanType }: { tenantId: string; spanType: string }) {
  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: tenantId,
    TraceId: traceId,
    SpanId: `${tenantId}-span`,
    ParentSpanId: null,
    ParentTraceId: null,
    ParentIsRemote: null,
    Sampled: 1,
    StartTime: new Date(T0 + 10),
    EndTime: new Date(T0 + 60),
    DurationMs: 50,
    SpanName: `${tenantId}-span`,
    SpanKind: 1,
    ServiceName: "test-service",
    ResourceAttributes: {},
    SpanAttributes: { "langwatch.span.type": spanType, orchestrator: "web" },
    StatusCode: 1,
    StatusMessage: "",
    ScopeName: "",
    ScopeVersion: null,
    CreatedAt: new Date(T0),
    UpdatedAt: new Date(T0),
  };
}

const settings = { async_insert: 0, wait_for_async_insert: 0 } as const;

beforeAll(async () => {
  ch = (await startMigratedClickHouse()).client;
  analytics = AnalyticsService.create({
    repository: ClickHouseAnalyticsRepository.create({ clickhouse: clickHouseQueryClientOver(ch) }),
    evaluationRepository: NullAnalyticsEvaluationRepository.create(),
    authz: analyticsTestAuthz(),
    tenantLimiter: new InProcessTenantStatementLimiter({
      maxConcurrent: 4,
      maxQueued: 64,
      waitTimeoutMs: 45_000,
      metricsInstance: "analytics-braided-trace-test",
      overloadErrorFactory: { create: ({ cause }: { cause: unknown }) => cause },
    }),
  });
  await ch.insert({
    table: "trace_summaries",
    values: [
      summaryRow({ tenantId: reader, cost: 0.25 }),
      summaryRow({ tenantId: owner, cost: 99 }),
    ],
    format: "JSONEachRow",
    clickhouse_settings: settings,
  });
  await ch.insert({
    table: "stored_spans",
    values: [
      spanRow({ tenantId: reader, spanType: "agent" }),
      spanRow({ tenantId: owner, spanType: "llm" }),
    ],
    format: "JSONEachRow",
    clickhouse_settings: settings,
  });
}, 120_000);

afterAll(async () => {
  if (!ch) return;
  for (const tenantId of [reader, owner]) {
    await deleteMigratedTenantRows({ client: ch, tenantId, tables: SEEDED_TABLES });
  }
});

/** Traces, cost, and traces holding an orchestrator-typed span or an owner-typed one. */
const SERIES: AnalyticsTimeseriesInput["series"] = [
  { metric: "metadata.trace_id", aggregation: "cardinality" },
  { metric: "performance.total_cost", aggregation: "sum" },
  { metric: "metadata.trace_id", aggregation: "cardinality", filters: { "spans.type": ["agent"] } },
  { metric: "metadata.trace_id", aggregation: "cardinality", filters: { "spans.type": ["llm"] } },
];

/** One project's panel over the trace both projects hold, one value per series. */
async function panel(projectId: string): Promise<number[]> {
  const result = await analytics.getTimeseries({
    projectId,
    startDate: T0 - 24 * 60 * 60 * 1000,
    endDate: T0 + 24 * 60 * 60 * 1000,
    filters: {},
    series: SERIES,
    timeScale: "full",
    timeZone: "UTC",
    traceIds: [traceId],
  });
  const [current] = result.currentPeriod;
  return SERIES.map((each, index) =>
    Number(current?.[`${index}/${each.metric}/${each.aggregation}`] ?? 0),
  );
}

describe("analytics over a trace holding a braided span", () => {
  describe("when sam reads it through analytics", () => {
    /** @scenario "<surface> shows only the project's own spans" */
    it("counts the orchestrator's trace, span and cost, and none of the owner's", async () => {
      expect(await panel(reader)).toEqual([1, 0.25, 1, 0]);
    });
  });

  describe("when the owner reads the same trace through its own analytics", () => {
    it("counts its own span and cost", async () => {
      expect(await panel(owner)).toEqual([1, 99, 0, 1]);
    });
  });
});
