/**
 * @vitest-environment node
 * @integration
 *
 * Integration coverage for the trace search projection DSL (Track 1, API Export
 * Traces RFC) — the END-TO-END projected SHAPE.
 *
 * Proves the feature-spec scenarios (`specs/traces/trace-search-projection.feature`)
 * against real infrastructure: the compiler plans, the ClickHouse read path runs
 * the bounded events JOIN over real `stored_spans`, the annotations JOIN runs
 * (through a fake `AnnotationService`, since Postgres has no testcontainer here),
 * and the per-trace projector renders the requested shape.
 */
import type { AnnotationScoreName } from "@langwatch/annotation-contract";
import { AnnotationService, type ProjectionAnnotation } from "@langwatch/annotation-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { TraceCanonicalisationService } from "../../../services/trace-canonicalisation.service";
import { enrichTracesWithEvaluations } from "../../../services/trace-evaluation-enrichment.rules";
import { compileProjection } from "../../../services/trace-projection-compile.service";
import type { ProjectableTrace, ProjectionFrom } from "../../../services/trace-projection.types";
import type { GetAllTracesForProjectInput } from "../../../services/trace-legacy-read.types";
import type { Protections } from "../../../services/trace-viewer-protections.service";
import { ClickHouseTraceService } from "../trace-legacy-read.repository";
import {
  createTestClickHouseClient,
  testClickHouseUrl,
} from "./support/clickhouse-endpoint.support";
import { openProtections } from "./open-protections";

const clickHouseUrl = testClickHouseUrl();
const integration = describe.skipIf(clickHouseUrl === null);

const tenantId = `test-projection-${nanoid()}`;
const traceId = `trace-projection-${nanoid()}`;
// A trace that OCCURRED long before the query window but was MODIFIED inside it
// — the case the updated date-axis must catch and the occurred axis must miss.
const lateTraceId = `trace-late-${nanoid()}`;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const now = Date.now();

// The AnnotationScore id whose definition names it "quality". In production
// scoreOptions is keyed by this id, NOT the name — the service joins
// AnnotationScore to remap id -> name for the name-addressable public contract.
const QUALITY_SCORE_ID = "annscore-quality-id";

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
    TopicId: null,
    SubTopicId: null,
    HasAnnotation: null,
    AnnotationIds: [],
    LastEventOccurredAt: new Date(now),
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

async function insert({ table, values }: { table: string; values: Record<string, unknown>[] }) {
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

/** A fake AnnotationService — no Postgres testcontainer here, so the service's
 *  own mapping (id -> name remap, ProjectedAnnotation shape) is exercised
 *  against canned rows instead of a real join. */
class FakeAnnotationService extends AnnotationService {
  rows: ProjectionAnnotation[] = [];
  scores: AnnotationScoreName[] = [];

  async listForProjection(): Promise<ProjectionAnnotation[]> {
    return this.rows;
  }

  async listScoreNames(): Promise<AnnotationScoreName[]> {
    return this.scores;
  }

  create(): never {
    throw new Error("not implemented in this fake");
  }
  update(): never {
    throw new Error("not implemented in this fake");
  }
  delete(): never {
    throw new Error("not implemented in this fake");
  }
  getById(): never {
    throw new Error("not implemented in this fake");
  }
  list(): never {
    throw new Error("not implemented in this fake");
  }
  getProjectOrganizationId(): never {
    throw new Error("not implemented in this fake");
  }
  assertQueueConfigurationReferences(): never {
    throw new Error("not implemented in this fake");
  }
  assertAnnotatorReferences(): never {
    throw new Error("not implemented in this fake");
  }
  upsertScore(): never {
    throw new Error("not implemented in this fake");
  }
  listScores(): never {
    throw new Error("not implemented in this fake");
  }
  getScore(): never {
    throw new Error("not implemented in this fake");
  }
  toggleScore(): never {
    throw new Error("not implemented in this fake");
  }
  deleteScore(): never {
    throw new Error("not implemented in this fake");
  }
  createQueueItems(): never {
    throw new Error("not implemented in this fake");
  }
}

let ch: ClickHouseClient;
let service: ClickHouseTraceService;
const annotations = new FakeAnnotationService();

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
  const results = await service.getAllTracesForProject(makeQueryInput(), protections, {
    downloadMode: true,
    projection: compiled.plan,
    dateField,
  });
  expect(results).not.toBeNull();
  const enriched = enrichTracesWithEvaluations({
    traces: results!.groups.flat(),
    traceChecks: results!.traceChecks,
  });
  return enriched.map((t) => compiled.project(t as unknown as ProjectableTrace));
}

integration("trace search projection (integration)", () => {
  beforeAll(async () => {
    if (!clickHouseUrl) return;
    ch = createTestClickHouseClient(clickHouseUrl);

    service = ClickHouseTraceService.create({
      prisma: {} as PrismaClient,
      resolveClickHouseClient: async () => ch,
      traceCanonicalisation: TraceCanonicalisationService.create(),
      annotations,
    });

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

    annotations.rows = [
      {
        id: `annotation-${nanoid()}`,
        traceId,
        isThumbsUp: true,
        comment: "looks right",
        expectedOutput: null,
        scoreOptions: { [QUALITY_SCORE_ID]: { value: "5", reason: "accurate" } },
        createdAt: new Date(now),
        anchorKind: null,
        anchorId: null,
        anchorPath: null,
      } as unknown as ProjectionAnnotation,
    ];
    annotations.scores = [{ id: QUALITY_SCORE_ID, name: "quality" } as AnnotationScoreName];
  }, 60_000);

  afterAll(async () => {
    if (!ch) return;
    for (const table of ["trace_summaries", "stored_spans", "evaluation_runs"]) {
      await ch.exec({
        query: `ALTER TABLE ${table} DELETE WHERE TenantId = {tenantId:String}`,
        query_params: { tenantId },
      });
    }
  });

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

    describe("when captured input is not visible", () => {
      /** @scenario "Projected event details are redacted when captured input is not visible" */
      it("redacts event detail values but keeps types and metrics", async () => {
        const rows = await projectedSearch({
          select: ["trace_id", "events.type", "events.metrics", "events.details"],
          protections: {
            canSeeCosts: true,
            canSeeCapturedInput: false,
            canSeeCapturedOutput: true,
          },
        });

        const row = rows.find((r) => r.trace_id === traceId);
        expect(row).toEqual({
          trace_id: traceId,
          events: [
            { type: "thumbs_up_down", metrics: { vote: 1 }, details: { reason: "[REDACTED]" } },
          ],
        });
      });
    });
  });

  describe("given a select over annotation fields", () => {
    describe("when the page is projected", () => {
      /** @scenario "Select annotation fields returned as nested array" */
      it("returns annotations joined as a nested array", async () => {
        const rows = await projectedSearch({
          select: ["trace_id", "annotations.is_thumbs_up", "annotations.scores"],
        });

        const row = rows.find((r) => r.trace_id === traceId);
        expect(row).toEqual({
          trace_id: traceId,
          annotations: [
            { is_thumbs_up: true, scores: { quality: { value: "5", reason: "accurate" } } },
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
        expect(row?.evaluations).toEqual([{ name: "Faithfulness", score: 0.91 }]);
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
          metrics: { total_cost: expect.closeTo(0.0031, 12) },
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
        const rows = await projectedSearch({ select: ["trace_id", "updated_at"] });
        expect(rows.some((r) => r.trace_id === lateTraceId)).toBe(false);
      });
    });
  });
});
