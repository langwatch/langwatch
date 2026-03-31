/**
 * Integration tests for trace deduplication queries.
 *
 * Verifies that the IN-tuple dedup pattern (replacing LIMIT 1 BY) correctly
 * returns only the latest version of each trace/span and preserves heavy
 * payload columns (ComputedInput, ComputedOutput, SpanAttributes).
 *
 * Uses testcontainers ClickHouse to exercise real SQL against the production schema.
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ClickHouseClient } from "@clickhouse/client";
import {
  startTestContainers,
  stopTestContainers,
} from "../../event-sourcing/__tests__/integration/testContainers";
import { ClickHouseTraceService } from "../clickhouse-trace.service";
import type { Protections } from "../../elasticsearch/protections";
import type { GetAllTracesForProjectInput } from "../types";

const tenantId = `test-trace-dedup-${nanoid()}`;
const now = Date.now();

/**
 * Build a trace_summaries insert row with sensible defaults.
 * Callers override specific fields for each test scenario.
 */
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

/**
 * Build a stored_spans insert row with sensible defaults.
 */
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

async function insertTraceSummary(
  ch: ClickHouseClient,
  row: ReturnType<typeof makeTraceSummaryRow>,
) {
  await ch.insert({
    table: "trace_summaries",
    values: [row],
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
}

async function insertSpan(
  ch: ClickHouseClient,
  row: ReturnType<typeof makeSpanRow>,
) {
  await ch.insert({
    table: "stored_spans",
    values: [row],
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
}

/**
 * Permissive protections that allow all fields to be visible.
 */
const openProtections: Protections = {
  canSeeCosts: true,
  canSeeCapturedInput: true,
  canSeeCapturedOutput: true,
};

/**
 * Helper to build a valid GetAllTracesForProjectInput with defaults.
 */
function makeQueryInput(
  overrides: Partial<GetAllTracesForProjectInput> = {},
): GetAllTracesForProjectInput {
  return {
    projectId: tenantId,
    startDate: now - 60_000,
    endDate: now + 60_000,
    filters: {},
    pageSize: 100,
    ...overrides,
  };
}

let ch: ClickHouseClient;

// Mock getClickHouseClientForProject to return the test container client
vi.mock("~/server/clickhouse/clickhouseClient", () => ({
  getClickHouseClientForProject: vi.fn(),
}));

// Mock prisma
vi.mock("~/server/db", () => ({
  prisma: {
    project: {
      findUnique: vi.fn().mockResolvedValue({
        featureClickHouseDataSourceTraces: true,
      }),
    },
  },
}));

// Lazy import so the mock is in place before the module loads
let getClickHouseClientForProject: ReturnType<typeof vi.fn>;

beforeAll(async () => {
  const containers = await startTestContainers();
  ch = containers.clickHouseClient;

  // Wire up the mock to return the test container's client
  const chModule = await import("~/server/clickhouse/clickhouseClient");
  getClickHouseClientForProject = vi.mocked(
    chModule.getClickHouseClientForProject,
  );
  getClickHouseClientForProject.mockResolvedValue(ch);
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
  }
  await stopTestContainers();
});

describe("ClickHouse trace dedup (integration)", () => {
  describe("getAllTracesForProject()", () => {
    describe("when multiple versions of the same trace exist", () => {
      const traceId = `trace-dedup-pagination-${nanoid()}`;
      const oldInput = JSON.stringify({
        type: "text",
        value: "old version input - " + "x".repeat(500),
      });
      const newInput = JSON.stringify({
        type: "text",
        value: "latest version input - " + "y".repeat(500),
      });
      const newOutput = JSON.stringify({
        type: "text",
        value: "latest version output - " + "z".repeat(500),
      });

      beforeAll(async () => {
        // Insert an older version (UpdatedAt = now - 5000)
        await insertTraceSummary(
          ch,
          makeTraceSummaryRow({
            TraceId: traceId,
            ComputedInput: oldInput,
            ComputedOutput: null,
            OccurredAt: new Date(now - 10000),
            CreatedAt: new Date(now - 10000),
            UpdatedAt: new Date(now - 5000),
            TotalDurationMs: 50,
          }),
        );

        // Insert a newer version (UpdatedAt = now)
        await insertTraceSummary(
          ch,
          makeTraceSummaryRow({
            TraceId: traceId,
            ComputedInput: newInput,
            ComputedOutput: newOutput,
            OccurredAt: new Date(now - 10000),
            CreatedAt: new Date(now - 10000),
            UpdatedAt: new Date(now),
            TotalDurationMs: 200,
          }),
        );
      });

      it("returns only the latest version of the trace", async () => {
        const { prisma } = await import("~/server/db");
        const service = new ClickHouseTraceService(
          prisma as Parameters<typeof ClickHouseTraceService.create>[0],
        );

        const result = await service.getAllTracesForProject(
          makeQueryInput(),
          openProtections,
        );

        expect(result).not.toBeNull();
        const traces = result!.groups.flat();
        const matching = traces.filter((t) => t.trace_id === traceId);

        // Dedup: only one row for this traceId
        expect(matching).toHaveLength(1);

        // It is the latest version (TotalDurationMs=200, not 50)
        const trace = matching[0]!;
        expect(trace.metrics?.total_time_ms).toBe(200);
      });

      it("preserves heavy ComputedInput/ComputedOutput columns", async () => {
        const { prisma } = await import("~/server/db");
        const service = new ClickHouseTraceService(
          prisma as Parameters<typeof ClickHouseTraceService.create>[0],
        );

        const result = await service.getAllTracesForProject(
          makeQueryInput(),
          openProtections,
        );

        const traces = result!.groups.flat();
        const trace = traces.find((t) => t.trace_id === traceId);
        expect(trace).toBeDefined();

        expect(trace!.input).not.toBeNull();
        // The input should be from the latest version
        const parsedInput =
          typeof trace!.input === "string"
            ? JSON.parse(trace!.input)
            : trace!.input;
        expect(parsedInput.value).toContain("latest version input");

        expect(trace!.output).not.toBeNull();
        const parsedOutput =
          typeof trace!.output === "string"
            ? JSON.parse(trace!.output)
            : trace!.output;
        expect(parsedOutput.value).toContain("latest version output");
      });
    });

    describe("when multiple distinct traces exist", () => {
      const traceA = `trace-multi-a-${nanoid()}`;
      const traceB = `trace-multi-b-${nanoid()}`;

      beforeAll(async () => {
        await insertTraceSummary(
          ch,
          makeTraceSummaryRow({
            TraceId: traceA,
            OccurredAt: new Date(now - 2000),
            CreatedAt: new Date(now - 2000),
            UpdatedAt: new Date(now - 1000),
            TotalDurationMs: 111,
          }),
        );
        await insertTraceSummary(
          ch,
          makeTraceSummaryRow({
            TraceId: traceB,
            OccurredAt: new Date(now - 1000),
            CreatedAt: new Date(now - 1000),
            UpdatedAt: new Date(now),
            TotalDurationMs: 222,
          }),
        );
      });

      it("returns both traces without duplication", async () => {
        const { prisma } = await import("~/server/db");
        const service = new ClickHouseTraceService(
          prisma as Parameters<typeof ClickHouseTraceService.create>[0],
        );

        const result = await service.getAllTracesForProject(
          makeQueryInput(),
          openProtections,
        );

        expect(result).not.toBeNull();
        const traces = result!.groups.flat();
        const matchingA = traces.find((t) => t.trace_id === traceA);
        const matchingB = traces.find((t) => t.trace_id === traceB);

        expect(matchingA).toBeDefined();
        expect(matchingB).toBeDefined();
        expect(matchingA!.metrics?.total_time_ms).toBe(111);
        expect(matchingB!.metrics?.total_time_ms).toBe(222);
      });
    });
  });

  describe("getTracesWithSpans()", () => {
    describe("when trace and spans have multiple versions", () => {
      const traceId = `trace-dedup-spans-${nanoid()}`;
      const spanId = `span-dedup-${nanoid()}`;
      const heavyAttrs = {
        "llm.model": "gpt-5-mini",
        payload: "a".repeat(500),
      };

      beforeAll(async () => {
        // Insert two versions of the trace summary
        await insertTraceSummary(
          ch,
          makeTraceSummaryRow({
            TraceId: traceId,
            ComputedInput: JSON.stringify({ type: "text", value: "old input" }),
            OccurredAt: new Date(now - 20000),
            CreatedAt: new Date(now - 20000),
            UpdatedAt: new Date(now - 10000),
            SpanCount: 1,
            TotalDurationMs: 50,
          }),
        );
        await insertTraceSummary(
          ch,
          makeTraceSummaryRow({
            TraceId: traceId,
            ComputedInput: JSON.stringify({
              type: "text",
              value:
                "latest input with heavy payload - " + "q".repeat(500),
            }),
            ComputedOutput: JSON.stringify({
              type: "text",
              value: "latest output - " + "r".repeat(500),
            }),
            OccurredAt: new Date(now - 20000),
            CreatedAt: new Date(now - 20000),
            UpdatedAt: new Date(now),
            SpanCount: 1,
            TotalDurationMs: 300,
          }),
        );

        // Insert two versions of the same span (different StartTime = version key)
        await insertSpan(
          ch,
          makeSpanRow({
            TraceId: traceId,
            SpanId: spanId,
            SpanName: "old-span-version",
            StartTime: new Date(now - 20000),
            EndTime: new Date(now - 19900),
            DurationMs: 100,
            SpanAttributes: { "llm.model": "old-model" },
          }),
        );
        await insertSpan(
          ch,
          makeSpanRow({
            TraceId: traceId,
            SpanId: spanId,
            SpanName: "latest-span-version",
            StartTime: new Date(now - 10000),
            EndTime: new Date(now - 9700),
            DurationMs: 300,
            SpanAttributes: heavyAttrs,
          }),
        );
      });

      it("returns only the latest trace summary version", async () => {
        const { prisma } = await import("~/server/db");
        const service = new ClickHouseTraceService(
          prisma as Parameters<typeof ClickHouseTraceService.create>[0],
        );

        const traces = await service.getTracesWithSpans(
          tenantId,
          [traceId],
          openProtections,
        );

        expect(traces).not.toBeNull();
        expect(traces).toHaveLength(1);

        const trace = traces![0]!;
        expect(trace.trace_id).toBe(traceId);
        expect(trace.metrics?.total_time_ms).toBe(300);
      });

      it("returns only the latest span version", async () => {
        const { prisma } = await import("~/server/db");
        const service = new ClickHouseTraceService(
          prisma as Parameters<typeof ClickHouseTraceService.create>[0],
        );

        const traces = await service.getTracesWithSpans(
          tenantId,
          [traceId],
          openProtections,
        );

        const trace = traces![0]!;
        expect(trace.spans).toHaveLength(1);

        const span = trace.spans[0]!;
        // The latest version has SpanName "latest-span-version"
        expect(span.name).toBe("latest-span-version");
      });

      it("preserves heavy SpanAttributes in the result", async () => {
        const { prisma } = await import("~/server/db");
        const service = new ClickHouseTraceService(
          prisma as Parameters<typeof ClickHouseTraceService.create>[0],
        );

        const traces = await service.getTracesWithSpans(
          tenantId,
          [traceId],
          openProtections,
        );

        const span = traces![0]!.spans[0]!;
        // SpanAttributes are mapped to params via unflattenDotNotation
        expect(span.params).toBeDefined();
        const params = span.params as Record<string, unknown>;
        // Dot-notation keys get unflattened: "llm.model" -> { llm: { model: "gpt-5-mini" } }
        expect(
          (params["llm"] as Record<string, string>)?.["model"],
        ).toBe("gpt-5-mini");
        expect(params["payload"]).toContain("a".repeat(100));
      });

      it("preserves heavy ComputedInput/ComputedOutput from the latest trace version", async () => {
        const { prisma } = await import("~/server/db");
        const service = new ClickHouseTraceService(
          prisma as Parameters<typeof ClickHouseTraceService.create>[0],
        );

        const traces = await service.getTracesWithSpans(
          tenantId,
          [traceId],
          openProtections,
        );

        const trace = traces![0]!;

        expect(trace.input).not.toBeNull();
        const parsedInput =
          typeof trace.input === "string"
            ? JSON.parse(trace.input)
            : trace.input;
        expect(parsedInput.value).toContain(
          "latest input with heavy payload",
        );

        expect(trace.output).not.toBeNull();
        const parsedOutput =
          typeof trace.output === "string"
            ? JSON.parse(trace.output)
            : trace.output;
        expect(parsedOutput.value).toContain("latest output");
      });
    });

    describe("when multiple traces each have multiple span versions", () => {
      const traceX = `trace-multi-span-x-${nanoid()}`;
      const traceY = `trace-multi-span-y-${nanoid()}`;
      const spanX1 = `span-x1-${nanoid()}`;
      const spanX2 = `span-x2-${nanoid()}`;
      const spanY1 = `span-y1-${nanoid()}`;

      beforeAll(async () => {
        // Trace X: 2 spans, each with 2 versions
        await insertTraceSummary(
          ch,
          makeTraceSummaryRow({
            TraceId: traceX,
            OccurredAt: new Date(now - 30000),
            CreatedAt: new Date(now - 30000),
            UpdatedAt: new Date(now),
            SpanCount: 2,
            TotalDurationMs: 400,
          }),
        );

        // Span X1: old version
        await insertSpan(
          ch,
          makeSpanRow({
            TraceId: traceX,
            SpanId: spanX1,
            SpanName: "span-x1-old",
            StartTime: new Date(now - 30000),
            EndTime: new Date(now - 29800),
            DurationMs: 200,
          }),
        );
        // Span X1: latest version
        await insertSpan(
          ch,
          makeSpanRow({
            TraceId: traceX,
            SpanId: spanX1,
            SpanName: "span-x1-latest",
            StartTime: new Date(now - 20000),
            EndTime: new Date(now - 19800),
            DurationMs: 200,
          }),
        );

        // Span X2: old version
        await insertSpan(
          ch,
          makeSpanRow({
            TraceId: traceX,
            SpanId: spanX2,
            SpanName: "span-x2-old",
            StartTime: new Date(now - 30000),
            EndTime: new Date(now - 29700),
            DurationMs: 300,
          }),
        );
        // Span X2: latest version
        await insertSpan(
          ch,
          makeSpanRow({
            TraceId: traceX,
            SpanId: spanX2,
            SpanName: "span-x2-latest",
            StartTime: new Date(now - 20000),
            EndTime: new Date(now - 19700),
            DurationMs: 300,
          }),
        );

        // Trace Y: 1 span, single version
        await insertTraceSummary(
          ch,
          makeTraceSummaryRow({
            TraceId: traceY,
            OccurredAt: new Date(now - 25000),
            CreatedAt: new Date(now - 25000),
            UpdatedAt: new Date(now),
            SpanCount: 1,
            TotalDurationMs: 150,
          }),
        );
        await insertSpan(
          ch,
          makeSpanRow({
            TraceId: traceY,
            SpanId: spanY1,
            SpanName: "span-y1-only",
            StartTime: new Date(now - 25000),
            EndTime: new Date(now - 24850),
            DurationMs: 150,
          }),
        );
      });

      it("deduplicates spans per trace correctly", async () => {
        const { prisma } = await import("~/server/db");
        const service = new ClickHouseTraceService(
          prisma as Parameters<typeof ClickHouseTraceService.create>[0],
        );

        const traces = await service.getTracesWithSpans(
          tenantId,
          [traceX, traceY],
          openProtections,
        );

        expect(traces).not.toBeNull();
        expect(traces).toHaveLength(2);

        const tX = traces!.find((t) => t.trace_id === traceX);
        const tY = traces!.find((t) => t.trace_id === traceY);

        expect(tX).toBeDefined();
        expect(tY).toBeDefined();

        // Trace X: 2 spans, each deduped to latest version
        expect(tX!.spans).toHaveLength(2);
        const spanNames = tX!.spans.map((s) => s.name).sort();
        expect(spanNames).toEqual(["span-x1-latest", "span-x2-latest"]);

        // Trace Y: 1 span, no dedup needed
        expect(tY!.spans).toHaveLength(1);
        expect(tY!.spans[0]!.name).toBe("span-y1-only");
      });
    });
  });
});
