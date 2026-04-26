/**
 * Integration tests for narrow projection on the trace list path.
 *
 * The default trace list query must NOT materialize multi-megabyte payload
 * columns (ComputedInput, ComputedOutput). Full content is only returned
 * when the caller passes `includeFullContent: true` (e.g. the triggers cron).
 *
 * Also verifies that the evaluation_runs enrichment query no longer uses
 * `SELECT *` (which leaks internal bookkeeping columns and doesn't constrain
 * future heavy columns).
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

const tenantId = `test-narrow-projection-${nanoid()}`;
const now = Date.now();

const LARGE_INPUT = "L".repeat(200_000);
const LARGE_OUTPUT = "M".repeat(200_000);
const PREVIEW_CAP = 10_000;

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

function makeEvaluationRow(overrides: Record<string, unknown> = {}) {
  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: tenantId,
    EvaluationId: `eval-${nanoid()}`,
    Version: "v1",
    EvaluatorId: "evaluator-1",
    EvaluatorType: "example",
    EvaluatorName: "Example",
    TraceId: null,
    IsGuardrail: 0,
    Status: "processed",
    Score: 0.9,
    Passed: 1,
    Label: null,
    Details: null,
    Error: null,
    Inputs: null,
    ScheduledAt: null,
    StartedAt: null,
    CompletedAt: null,
    LastProcessedEventId: `evt-${nanoid()}`,
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

async function insertEvaluation(
  ch: ClickHouseClient,
  row: ReturnType<typeof makeEvaluationRow>,
) {
  await ch.insert({
    table: "evaluation_runs",
    values: [row],
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
}

const openProtections: Protections = {
  canSeeCosts: true,
  canSeeCapturedInput: true,
  canSeeCapturedOutput: true,
};

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
  const mocked = vi.mocked(chModule.getClickHouseClientForProject);
  mocked.mockResolvedValue(ch);

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
      query: `ALTER TABLE evaluation_runs DELETE WHERE TenantId = {tenantId:String}`,
      query_params: { tenantId },
    });
  }
  await stopTestContainers();
});

describe("ClickHouse trace list narrow projection (integration)", () => {
  describe("given a trace with 200KB ComputedInput and ComputedOutput", () => {
    const traceId = `trace-narrow-${nanoid()}`;

    beforeAll(async () => {
      await insertTraceSummary(
        ch,
        makeTraceSummaryRow({
          TraceId: traceId,
          ComputedInput: JSON.stringify({ type: "text", value: LARGE_INPUT }),
          ComputedOutput: JSON.stringify({ type: "text", value: LARGE_OUTPUT }),
        }),
      );
    });

    describe("when the caller does not opt into full content", () => {
      it("truncates input.value to the preview cap", async () => {
        const result = await service.getAllTracesForProject(
          makeQueryInput(),
          openProtections,
        );

        const trace = result!.groups
          .flat()
          .find((t) => t.trace_id === traceId)!;

        expect(trace.input?.value).toBeDefined();
        expect(trace.input!.value!.length).toBeLessThanOrEqual(PREVIEW_CAP);
        expect(trace.input!.value!.length).toBeLessThan(LARGE_INPUT.length);
      });

      it("truncates output.value to the preview cap", async () => {
        const result = await service.getAllTracesForProject(
          makeQueryInput(),
          openProtections,
        );

        const trace = result!.groups
          .flat()
          .find((t) => t.trace_id === traceId)!;

        expect(trace.output?.value).toBeDefined();
        expect(trace.output!.value!.length).toBeLessThanOrEqual(PREVIEW_CAP);
        expect(trace.output!.value!.length).toBeLessThan(LARGE_OUTPUT.length);
      });
    });

    describe("when the caller opts into full content", () => {
      it("returns the full untruncated input value", async () => {
        const result = await service.getAllTracesForProject(
          makeQueryInput(),
          openProtections,
          { includeFullContent: true },
        );

        const trace = result!.groups
          .flat()
          .find((t) => t.trace_id === traceId)!;

        expect(trace.input?.value).toBe(LARGE_INPUT);
      });

      it("returns the full untruncated output value", async () => {
        const result = await service.getAllTracesForProject(
          makeQueryInput(),
          openProtections,
          { includeFullContent: true },
        );

        const trace = result!.groups
          .flat()
          .find((t) => t.trace_id === traceId)!;

        expect(trace.output?.value).toBe(LARGE_OUTPUT);
      });
    });
  });

  describe("given a trace with a matching evaluation_runs row", () => {
    const traceId = `trace-eval-${nanoid()}`;
    const evaluationId = `eval-narrow-${nanoid()}`;

    beforeAll(async () => {
      await insertTraceSummary(
        ch,
        makeTraceSummaryRow({ TraceId: traceId }),
      );

      await insertEvaluation(
        ch,
        makeEvaluationRow({
          TraceId: traceId,
          EvaluationId: evaluationId,
          Score: 0.42,
          Status: "processed",
          Label: "ok",
        }),
      );
    });

    it("enriches traces with evaluation data using an explicit projection (not SELECT *)", async () => {
      const result = await service.getAllTracesForProject(
        makeQueryInput(),
        openProtections,
      );

      const trace = result!.groups
        .flat()
        .find((t) => t.trace_id === traceId)!;

      const checks = result!.traceChecks?.[traceId] ?? [];
      const evalEntry = checks.find((c) => c.evaluation_id === evaluationId);

      expect(trace).toBeDefined();
      expect(evalEntry).toBeDefined();
      expect(evalEntry!.score).toBe(0.42);
    });
  });

  describe("given many traces, the default list must not load full content", () => {
    const n = 5;
    const traceIds = Array.from({ length: n }, (_, i) => `bulk-${i}-${nanoid()}`);

    beforeAll(async () => {
      for (const id of traceIds) {
        await insertTraceSummary(
          ch,
          makeTraceSummaryRow({
            TraceId: id,
            ComputedInput: JSON.stringify({ type: "text", value: LARGE_INPUT }),
            ComputedOutput: JSON.stringify({ type: "text", value: LARGE_OUTPUT }),
          }),
        );
      }
    });

    it("returns all rows but each trace's input/output stays within the preview cap", async () => {
      const result = await service.getAllTracesForProject(
        makeQueryInput({ pageSize: n * 2 }),
        openProtections,
      );

      const returned = result!.groups
        .flat()
        .filter((t) => traceIds.includes(t.trace_id));

      expect(returned).toHaveLength(n);
      for (const trace of returned) {
        expect(trace.input?.value?.length ?? 0).toBeLessThanOrEqual(PREVIEW_CAP);
        expect(trace.output?.value?.length ?? 0).toBeLessThanOrEqual(PREVIEW_CAP);
      }
    });
  });
});
