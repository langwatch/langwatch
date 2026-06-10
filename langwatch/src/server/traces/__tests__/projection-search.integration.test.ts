/**
 * Integration coverage for the trace search projection DSL (Track 1, API Export
 * Traces RFC) — the END-TO-END projected SHAPE.
 *
 * Proves the feature-spec scenarios (`specs/traces/trace-search-projection.feature`)
 * against real infrastructure: the compiler plans, the ClickHouse read path runs
 * the bounded events JOIN over real `stored_spans`, the Postgres annotations JOIN
 * runs (Prisma mocked — there is no PG testcontainer here, but the service's
 * mapping is exercised), and the per-trace projector renders the requested shape.
 *
 * The seam with the service's own tests: this file asserts the projected OUTPUT
 * (the contract a caller sees), including the `dateField: "updated"` axis SHAPE
 * (a late-modified trace is caught on the updated axis, missed on the occurred
 * axis). The mechanism — IN-tuple dedup, the ±2-day partition window, `mapFilter`
 * event-attr extraction, `LIMIT N BY`, and the updated-axis pagination-completeness
 * proof — lives in the ClickHouseTraceService tests, not here.
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { getClickHouseClientForProject } from "~/server/clickhouse/clickhouseClient";
import { prisma } from "~/server/db";
import type { Protections } from "../../elasticsearch/protections";
import {
  startTestContainers,
  stopTestContainers,
} from "../../event-sourcing/__tests__/integration/testContainers";
import { ClickHouseTraceService } from "../clickhouse-trace.service";
import { enrichTracesWithEvaluations } from "../enrich-evaluations";
import {
  compileProjection,
  type ProjectableTrace,
  type ProjectionFrom,
} from "../projection";
import type { GetAllTracesForProjectInput } from "../types";

const tenantId = `test-projection-${nanoid()}`;
const traceId = `trace-projection-${nanoid()}`;
// A trace that OCCURRED long before the query window but was MODIFIED inside it
// — the case the updated date-axis must catch and the occurred axis must miss.
const lateTraceId = `trace-late-${nanoid()}`;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const now = Date.now();

const openProtections: Protections = {
  canSeeCosts: true,
  canSeeCapturedInput: true,
  canSeeCapturedOutput: true,
};

function makeTraceSummaryRow(overrides: Record<string, unknown> = {}) {
  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: tenantId,
    TraceId: traceId,
    Version: "v1",
    Attributes: { "langwatch.user_id": "u_42" },
    OccurredAt: new Date(now),
    CreatedAt: new Date(now),
    UpdatedAt: new Date(now),
    ComputedIOSchemaVersion: "v1",
    ComputedInput: JSON.stringify({ type: "text", value: "captured input" }),
    ComputedOutput: JSON.stringify({ type: "text", value: "captured output" }),
    TimeToFirstTokenMs: null,
    TimeToLastTokenMs: null,
    TotalDurationMs: 100,
    TokensPerSecond: null,
    SpanCount: 1,
    ContainsErrorStatus: false,
    ContainsOKStatus: true,
    ErrorMessage: null,
    Models: [],
    TotalCost: 0.0031,
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

/** A stored_spans row carrying `event.*` attributes — one feedback event. */
function makeEventSpanRow({
  spanAttributes,
  overrides = {},
}: {
  spanAttributes: Record<string, string>;
  overrides?: Record<string, unknown>;
}) {
  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: tenantId,
    TraceId: traceId,
    SpanId: `event-span-${nanoid()}`,
    ParentSpanId: null,
    ParentTraceId: null,
    ParentIsRemote: null,
    Sampled: 1,
    StartTime: new Date(now),
    EndTime: new Date(now + 5),
    DurationMs: 5,
    SpanName: "event",
    SpanKind: 1,
    ServiceName: "test-service",
    ResourceAttributes: {},
    SpanAttributes: spanAttributes,
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

function makeEvaluationRunRow(overrides: Record<string, unknown> = {}) {
  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: tenantId,
    EvaluationId: `eval-${nanoid()}`,
    Version: "v1",
    EvaluatorId: `evaluator-${nanoid()}`,
    EvaluatorType: "custom/test",
    EvaluatorName: "Faithfulness",
    TraceId: traceId,
    IsGuardrail: 0,
    Status: "processed",
    Score: 0.91,
    Passed: 1,
    Label: null,
    Details: null,
    Error: null,
    ErrorDetails: null,
    LastProcessedEventId: `evt-${nanoid()}`,
    ScheduledAt: new Date(now),
    CreatedAt: new Date(now),
    UpdatedAt: new Date(now),
    LastEventOccurredAt: new Date(now),
    ...overrides,
  };
}

async function insert({
  table,
  values,
}: {
  table: string;
  values: Record<string, unknown>[];
}) {
  await ch.insert({
    table,
    values,
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
}

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
let service: ClickHouseTraceService;
let annotationFindMany: ReturnType<typeof vi.fn>;

vi.mock("~/server/clickhouse/clickhouseClient", () => ({
  getClickHouseClientForProject: vi.fn(),
}));

vi.mock("~/server/db", () => ({
  prisma: {
    project: { findUnique: vi.fn().mockResolvedValue({}) },
    annotation: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

/**
 * Run the full surface pipeline against the real service: compile the
 * projection, fetch the page, enrich evaluations exactly as the route does,
 * then project each trace. Returns the projected rows a caller would receive.
 */
async function projectedSearch({
  select,
  from,
  protections = openProtections,
  dateField,
}: {
  select: string[];
  from?: ProjectionFrom;
  protections?: Protections;
  dateField?: "occurred" | "updated";
}) {
  const compiled = compileProjection({ from, select, protections });
  const results = await service.getAllTracesForProject(
    makeQueryInput(),
    protections,
    {
      downloadMode: true,
      projection: compiled.plan,
      dateField,
    },
  );
  expect(results).not.toBeNull();
  const enriched = enrichTracesWithEvaluations({
    traces: results!.groups.flat(),
    traceChecks: results!.traceChecks,
  });
  return enriched.map((t) => compiled.project(t as ProjectableTrace));
}

beforeAll(async () => {
  const containers = await startTestContainers();
  ch = containers.clickHouseClient;

  vi.mocked(getClickHouseClientForProject).mockResolvedValue(ch);

  annotationFindMany = vi.mocked(prisma.annotation.findMany);
  service = new ClickHouseTraceService(
    prisma as ConstructorParameters<typeof ClickHouseTraceService>[0],
  );

  await insert({
    table: "trace_summaries",
    values: [
      makeTraceSummaryRow(),
      // Occurred 30 days ago, last modified now.
      makeTraceSummaryRow({
        TraceId: lateTraceId,
        OccurredAt: new Date(now - THIRTY_DAYS_MS),
        CreatedAt: new Date(now - THIRTY_DAYS_MS),
        UpdatedAt: new Date(now),
      }),
    ],
  });
  await insert({
    table: "stored_spans",
    values: [
      makeEventSpanRow({
        spanAttributes: {
          "event.type": "thumbs_up_down",
          "event.metrics.vote": "1",
          "event.details.reason": "great answer",
        },
      }),
    ],
  });
  await insert({ table: "evaluation_runs", values: [makeEvaluationRunRow()] });

  // The Postgres annotations JOIN is mocked (no PG testcontainer here); the
  // service still maps these rows into ProjectedAnnotation[] for the projector.
  annotationFindMany.mockResolvedValue([
    {
      id: `annotation-${nanoid()}`,
      traceId,
      isThumbsUp: true,
      comment: "looks right",
      expectedOutput: null,
      scoreOptions: { quality: { value: "5", reason: "accurate" } },
      createdAt: new Date(now),
    },
  ]);
}, 60_000);

afterAll(async () => {
  if (ch) {
    for (const table of [
      "trace_summaries",
      "stored_spans",
      "evaluation_runs",
    ]) {
      await ch.exec({
        query: `ALTER TABLE ${table} DELETE WHERE TenantId = {tenantId:String}`,
        query_params: { tenantId },
      });
    }
  }
  await stopTestContainers();
});

describe("trace search projection (integration)", () => {
  describe("given a select over event fields", () => {
    describe("when the page is projected", () => {
      /** @scenario "Select event fields returned as nested array" */
      it("returns events as a nested array of only the requested fields", async () => {
        const rows = await projectedSearch({
          select: ["trace_id", "events.type", "events.metrics"],
        });

        const row = rows.find((r) => r.trace_id === traceId);
        expect(row).toBeDefined();
        expect(row).toEqual({
          trace_id: traceId,
          events: [{ type: "thumbs_up_down", metrics: { vote: 1 } }],
        });
      });
    });
  });

  describe("given a select over annotation fields", () => {
    describe("when the page is projected", () => {
      /** @scenario "Select annotation fields returned as nested array" */
      it("returns annotations joined from Postgres as a nested array", async () => {
        const rows = await projectedSearch({
          select: [
            "trace_id",
            "annotations.is_thumbs_up",
            "annotations.scores",
          ],
        });

        const row = rows.find((r) => r.trace_id === traceId);
        expect(row).toEqual({
          trace_id: traceId,
          annotations: [
            {
              is_thumbs_up: true,
              scores: { quality: { value: "5", reason: "accurate" } },
            },
          ],
        });
      });
    });
  });

  describe("given a select over evaluation fields", () => {
    describe("when the page is projected", () => {
      /** @scenario "Select evaluation fields returned as nested array" */
      it("returns evaluations as a nested array of only the requested fields", async () => {
        const rows = await projectedSearch({
          select: ["trace_id", "evaluations.name", "evaluations.score"],
        });

        const row = rows.find((r) => r.trace_id === traceId);
        expect(row?.evaluations).toEqual([
          { name: "Faithfulness", score: 0.91 },
        ]);
      });
    });
  });

  describe("given a select that omits input and output", () => {
    describe("when the page is projected", () => {
      it("returns only the requested lightweight fields, with no io keys", async () => {
        const rows = await projectedSearch({
          select: ["trace_id", "metadata.user_id", "metrics.total_cost"],
        });

        const row = rows.find((r) => r.trace_id === traceId);
        expect(row).toEqual({
          trace_id: traceId,
          metadata: { user_id: "u_42" },
          metrics: { total_cost: 0.0031 },
        });
        expect(row).not.toHaveProperty("input");
        expect(row).not.toHaveProperty("output");
      });
    });
  });

  describe("given a select spanning every source", () => {
    describe("when the page is projected in a single call", () => {
      /** @scenario "Select fields from all sources in a single request" */
      it("returns scalar, grouped, and all nested collections together", async () => {
        const rows = await projectedSearch({
          select: [
            "trace_id",
            "started_at",
            "metadata.user_id",
            "metrics.total_cost",
            "events.type",
            "annotations.is_thumbs_up",
            "evaluations.score",
          ],
        });

        const row = rows.find((r) => r.trace_id === traceId);
        expect(row).toMatchObject({
          trace_id: traceId,
          metadata: { user_id: "u_42" },
          metrics: { total_cost: 0.0031 },
          events: [{ type: "thumbs_up_down" }],
          annotations: [{ is_thumbs_up: true }],
          evaluations: [{ score: 0.91 }],
        });
        expect(typeof row?.started_at).toBe("number");
      });
    });
  });

  describe("given a trace that occurred long ago but was modified recently", () => {
    describe("when searching on the updated axis", () => {
      /** @scenario "Updated axis captures a late-mutated old trace" */
      it("includes the late-modified trace", async () => {
        const rows = await projectedSearch({
          select: ["trace_id", "updated_at"],
          dateField: "updated",
        });
        expect(rows.some((r) => r.trace_id === lateTraceId)).toBe(true);
      });
    });

    describe("when searching on the default occurred axis", () => {
      /** @scenario "Default date axis is occurrence" */
      it("excludes the trace whose occurrence is outside the window", async () => {
        const rows = await projectedSearch({
          select: ["trace_id", "updated_at"],
        });
        expect(rows.some((r) => r.trace_id === lateTraceId)).toBe(false);
      });
    });
  });
});
