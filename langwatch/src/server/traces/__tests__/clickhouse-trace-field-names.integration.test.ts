/**
 * Integration tests for the queries that feed the "Add to Dataset" / evaluator
 * field-mapping dropdowns.
 *
 * The dropdowns let users map a trace field (span name, metadata key) to a
 * dataset column. The server queries that back them must not silently truncate
 * their results: a customer reported a span that clearly existed on a recent
 * trace not being offered for mapping, traced back to hard `LIMIT` caps in
 * these queries. These tests run real SQL against a ClickHouse testcontainer
 * to prove every distinct name / span is returned even on large lists.
 */

import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  startTestContainers,
  stopTestContainers,
} from "../../event-sourcing/__tests__/integration/testContainers";
import { ClickHouseTraceService } from "../clickhouse-trace.service";
import type { Protections } from "../protections";

const tenantId = `test-field-names-${nanoid()}`;
const now = Date.now();

function makeTraceSummaryRow(overrides: Record<string, unknown> = {}) {
  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: tenantId,
    TraceId: `trace-${nanoid()}`,
    Version: "v1",
    Attributes: {},
    OccurredAt: new Date(now),
    CreatedAt: new Date(now),
    UpdatedAt: new Date(now),
    ComputedIOSchemaVersion: "v1",
    ComputedInput: null,
    ComputedOutput: null,
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
    SatisfactionScore: null,
    TopicId: null,
    SubTopicId: null,
    HasAnnotation: null,
    ...overrides,
  };
}

function makeSpanRow(overrides: Record<string, unknown> = {}) {
  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: tenantId,
    TraceId: `trace-${nanoid()}`,
    SpanId: `span-${nanoid()}`,
    ParentSpanId: null,
    ParentTraceId: null,
    ParentIsRemote: null,
    Sampled: 1,
    StartTime: new Date(now),
    EndTime: new Date(now + 100),
    DurationMs: 100,
    SpanName: "test-span",
    SpanKind: 1,
    ServiceName: "test-service",
    ResourceAttributes: {},
    SpanAttributes: {},
    StatusCode: 1,
    StatusMessage: null,
    ScopeName: "test",
    ScopeVersion: null,
    "Events.Timestamp": [],
    "Events.Name": [],
    "Events.Attributes": [],
    "Links.TraceId": [],
    "Links.SpanId": [],
    "Links.Attributes": [],
    DroppedAttributesCount: 0,
    DroppedEventsCount: 0,
    DroppedLinksCount: 0,
    CreatedAt: new Date(now),
    UpdatedAt: new Date(now),
    ...overrides,
  };
}

async function insertSpans(
  ch: ClickHouseClient,
  rows: ReturnType<typeof makeSpanRow>[],
) {
  await ch.insert({
    table: "stored_spans",
    values: rows,
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
}

async function insertTraceSummaries(
  ch: ClickHouseClient,
  rows: ReturnType<typeof makeTraceSummaryRow>[],
) {
  await ch.insert({
    table: "trace_summaries",
    values: rows,
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
}

function makeEvaluationRunRow(overrides: Record<string, unknown> = {}) {
  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: tenantId,
    EvaluationId: `eval-${nanoid()}`,
    Version: "v1",
    EvaluatorId: `evaluator-${nanoid()}`,
    EvaluatorType: "custom/test",
    EvaluatorName: "test-evaluator",
    TraceId: `trace-${nanoid()}`,
    Status: "processed",
    LastProcessedEventId: `evt-${nanoid()}`,
    ScheduledAt: new Date(now),
    CreatedAt: new Date(now),
    UpdatedAt: new Date(now),
    LastEventOccurredAt: new Date(now),
    ...overrides,
  };
}

async function insertEvaluationRuns(
  ch: ClickHouseClient,
  rows: ReturnType<typeof makeEvaluationRunRow>[],
) {
  await ch.insert({
    table: "evaluation_runs",
    values: rows,
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
}

const openProtections: Protections = {
  canSeeCosts: true,
  canSeeCapturedInput: true,
  canSeeCapturedOutput: true,
};

// A list large enough to blow past the historical 1000 / 200 caps.
const LARGE_NAME_COUNT = 1500;
const LARGE_SPAN_COUNT = 250;
const pad = (n: number) => String(n).padStart(4, "0");

let ch: ClickHouseClient;
let service: ClickHouseTraceService;

vi.mock("~/server/clickhouse/clickhouseClient", () => ({
  getClickHouseClientForProject: vi.fn(),
}));

vi.mock("~/server/db", () => ({
  prisma: {
    project: {
      findUnique: vi.fn().mockResolvedValue({}),
    },
  },
}));

beforeAll(async () => {
  const containers = await startTestContainers();
  ch = containers.clickHouseClient;

  const chModule = await import("~/server/clickhouse/clickhouseClient");
  vi.mocked(chModule.getClickHouseClientForProject).mockResolvedValue(ch);

  const { prisma } = await import("~/server/db");
  service = new ClickHouseTraceService(
    prisma as ConstructorParameters<typeof ClickHouseTraceService>[0],
  );
}, 60_000);

afterAll(async () => {
  if (ch) {
    await ch.exec({
      query: `ALTER TABLE trace_summaries DELETE WHERE TenantId = {tenantId:String}`,
      query_params: { tenantId },
    });
    await ch.exec({
      query: `ALTER TABLE stored_spans DELETE WHERE TenantId = {tenantId:String}`,
      query_params: { tenantId },
    });
    await ch.exec({
      query: `ALTER TABLE evaluation_runs DELETE WHERE TenantId = {tenantId:String}`,
      query_params: { tenantId },
    });
  }
  await stopTestContainers();
});

describe("ClickHouse field-name queries (integration)", () => {
  describe("getDistinctFieldNames()", () => {
    describe("when the project has more than a thousand distinct span names", () => {
      const traceId = `trace-many-names-${nanoid()}`;

      beforeAll(async () => {
        // Alphabetically-ordered, zero-padded names so the historical
        // `ORDER BY SpanName ASC LIMIT 1000` would keep 0000..0999 and drop
        // the rest — making the assertion on the last name a precise probe.
        await insertSpans(
          ch,
          Array.from({ length: LARGE_NAME_COUNT }, (_, i) =>
            makeSpanRow({
              TraceId: traceId,
              SpanId: `span-name-${pad(i)}-${nanoid()}`,
              SpanName: `span-name-${pad(i)}`,
            }),
          ),
        );
      });

      /** @scenario All distinct span names are returned even for projects with thousands of them */
      it("returns every distinct span name, none dropped", async () => {
        const result = await service.getDistinctFieldNames(
          tenantId,
          now - 60_000,
          now + 60_000,
        );

        expect(result).not.toBeNull();
        const names = new Set(result!.spanNames.map((s) => s.key));

        expect(names.size).toBe(LARGE_NAME_COUNT);
        // The alphabetically-last name is the one the old LIMIT 1000 dropped.
        expect(names.has(`span-name-${pad(LARGE_NAME_COUNT - 1)}`)).toBe(true);
        expect(names.has("span-name-0000")).toBe(true);
      });
    });

    describe("when the project has more than a thousand distinct metadata keys", () => {
      beforeAll(async () => {
        const attributes: Record<string, string> = {};
        for (let i = 0; i < LARGE_NAME_COUNT; i++) {
          attributes[`meta-key-${pad(i)}`] = "v";
        }
        await insertTraceSummaries(ch, [
          makeTraceSummaryRow({
            TraceId: `trace-many-meta-${nanoid()}`,
            Attributes: attributes,
          }),
        ]);
      });

      /** @scenario All metadata keys are returned even for projects with thousands of them */
      it("returns every distinct metadata key, none dropped", async () => {
        const result = await service.getDistinctFieldNames(
          tenantId,
          now - 60_000,
          now + 60_000,
        );

        expect(result).not.toBeNull();
        const keys = new Set(result!.metadataKeys.map((k) => k.key));

        expect(keys.has(`meta-key-${pad(LARGE_NAME_COUNT - 1)}`)).toBe(true);
        expect(keys.has("meta-key-0000")).toBe(true);
      });
    });

    describe("when the project has more than a thousand distinct evaluator names", () => {
      beforeAll(async () => {
        // Distinct evaluator id + name pairs spread across many traces, so the
        // names live project-wide rather than on any single open trace.
        await insertEvaluationRuns(
          ch,
          Array.from({ length: LARGE_NAME_COUNT }, (_, i) =>
            makeEvaluationRunRow({
              EvaluatorId: `evaluator-${pad(i)}`,
              EvaluatorName: `evaluator-name-${pad(i)}`,
            }),
          ),
        );
      });

      /** @scenario All distinct evaluator names are returned even for projects with thousands of them */
      it("returns every distinct evaluator name, none dropped", async () => {
        const result = await service.getDistinctFieldNames(
          tenantId,
          now - 60_000,
          now + 60_000,
        );

        expect(result).not.toBeNull();
        const ids = new Set(result!.evaluationNames.map((e) => e.key));
        const labels = new Set(result!.evaluationNames.map((e) => e.label));

        expect(ids.size).toBe(LARGE_NAME_COUNT);
        expect(ids.has(`evaluator-${pad(LARGE_NAME_COUNT - 1)}`)).toBe(true);
        expect(ids.has("evaluator-0000")).toBe(true);
        // The key is the evaluator id, the label its human-readable name.
        expect(labels.has(`evaluator-name-${pad(LARGE_NAME_COUNT - 1)}`)).toBe(
          true,
        );
      });
    });
  });

  describe("getTracesWithSpans()", () => {
    describe("when a single trace has more than two hundred spans", () => {
      const traceId = `trace-big-${nanoid()}`;

      beforeAll(async () => {
        await insertTraceSummaries(ch, [
          makeTraceSummaryRow({
            TraceId: traceId,
            SpanCount: LARGE_SPAN_COUNT,
          }),
        ]);
        // Distinct, increasing StartTime so the historical
        // `ORDER BY StartTime ASC LIMIT 200 BY TraceId` keeps the first 200
        // and drops the tail — the last span is a precise probe for the cap.
        await insertSpans(
          ch,
          Array.from({ length: LARGE_SPAN_COUNT }, (_, i) =>
            makeSpanRow({
              TraceId: traceId,
              SpanId: `bigspan-${pad(i)}-${nanoid()}`,
              SpanName: `bigspan-${pad(i)}`,
              StartTime: new Date(now + i),
              EndTime: new Date(now + i + 10),
            }),
          ),
        );
      });

      /** @scenario A trace with many spans exposes all of its spans */
      it("returns all spans of the trace, none dropped", async () => {
        const traces = await service.getTracesWithSpans(
          tenantId,
          [traceId],
          openProtections,
        );

        expect(traces).not.toBeNull();
        expect(traces).toHaveLength(1);

        const spans = traces![0]!.spans;
        expect(spans).toHaveLength(LARGE_SPAN_COUNT);

        const spanNames = new Set(spans.map((s) => s.name));
        // The last span by StartTime is what the old LIMIT 200 BY dropped.
        expect(spanNames.has(`bigspan-${pad(LARGE_SPAN_COUNT - 1)}`)).toBe(
          true,
        );
      });
    });
  });
});
