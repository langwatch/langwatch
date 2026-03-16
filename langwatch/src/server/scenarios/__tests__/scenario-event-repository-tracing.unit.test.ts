/**
 * Unit tests for OTel tracing on ScenarioEventRepository methods.
 *
 * Verifies that each previously-untraced public method emits an OTel span
 * with the correct name, kind, and attributes (db.system, db.operation, tenant.id),
 * and sets result attributes on the span after execution.
 *
 * @see specs/scenarios/scenario-event-repository-tracing.feature
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { SpanKind } from "@opentelemetry/api";

const { withActiveSpanCalls, mockSearch } = vi.hoisted(() => {
  const withActiveSpanCalls: Array<{
    name: string;
    options: { kind: number; attributes: Record<string, unknown> };
    span: { setAttribute: ReturnType<typeof vi.fn> };
  }> = [];

  const mockSearch = vi.fn().mockResolvedValue({
    hits: { hits: [], total: { value: 0 } },
    aggregations: {
      unique_batch_run_count: { value: 0 },
      unique_scenario_runs: { buckets: [] },
      max_timestamp: { value: 0 },
      batch_runs: { buckets: [] },
    },
  });

  return { withActiveSpanCalls, mockSearch };
});

vi.mock("langwatch", () => ({
  getLangWatchTracer: () => ({
    withActiveSpan: (
      name: string,
      opts: { kind: number; attributes: Record<string, unknown> },
      fn: (span: { setAttribute: ReturnType<typeof vi.fn> }) => unknown
    ) => {
      const span = { setAttribute: vi.fn() };
      withActiveSpanCalls.push({ name, options: opts, span });
      return fn(span);
    },
  }),
}));

vi.mock("~/utils/logger/server", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock("~/utils/posthogErrorCapture", () => ({
  captureException: vi.fn(),
}));

vi.mock("~/server/elasticsearch", () => ({
  esClient: vi.fn().mockResolvedValue({ search: mockSearch }),
  SCENARIO_EVENTS_INDEX: { alias: "scenario_events" },
}));

// Mock generated types module (build artifact, not present in raw checkout)
vi.mock("~/server/tracer/types.generated", () => ({
  chatMessageSchema: vi.fn(),
}));

// Import AFTER mocks
import { ScenarioEventRepository } from "../scenario-event.repository";

describe("ScenarioEventRepository OTel tracing", () => {
  let repo: ScenarioEventRepository;

  beforeEach(() => {
    withActiveSpanCalls.length = 0;
    mockSearch.mockClear();
    repo = new ScenarioEventRepository();
  });

  describe("when getBatchRunIdsForScenarioSet is called", () => {
    it("creates a span with correct name and attributes", async () => {
      await repo.getBatchRunIdsForScenarioSet({
        projectId: "proj_1",
        scenarioSetId: "set_1",
        limit: 10,
      });

      const call = withActiveSpanCalls.find(
        (c) => c.name === "ScenarioEventRepository.getBatchRunIdsForScenarioSet"
      );
      expect(call).toBeDefined();
      expect(call!.options.kind).toBe(SpanKind.CLIENT);
      expect(call!.options.attributes["db.system"]).toBe("elasticsearch");
      expect(call!.options.attributes["db.operation"]).toBe("SEARCH");
      expect(call!.options.attributes["tenant.id"]).toBe("proj_1");
      expect(call!.options.attributes["scenario.set.id"]).toBe("set_1");
      expect(call!.span.setAttribute).toHaveBeenCalledWith("result.count", 0);
    });
  });

  describe("when getBatchRunIdsForAllSuites is called", () => {
    it("creates a span with correct name and attributes", async () => {
      await repo.getBatchRunIdsForAllSuites({
        projectId: "proj_2",
        limit: 10,
      });

      const call = withActiveSpanCalls.find(
        (c) => c.name === "ScenarioEventRepository.getBatchRunIdsForAllSuites"
      );
      expect(call).toBeDefined();
      expect(call!.options.kind).toBe(SpanKind.CLIENT);
      expect(call!.options.attributes["db.system"]).toBe("elasticsearch");
      expect(call!.options.attributes["db.operation"]).toBe("SEARCH");
      expect(call!.options.attributes["tenant.id"]).toBe("proj_2");
      expect(call!.span.setAttribute).toHaveBeenCalledWith("result.count", 0);
    });
  });

  describe("when getBatchRunCountForScenarioSet is called", () => {
    it("creates a span with correct name and attributes", async () => {
      await repo.getBatchRunCountForScenarioSet({
        projectId: "proj_3",
        scenarioSetId: "set_3",
      });

      const call = withActiveSpanCalls.find(
        (c) => c.name === "ScenarioEventRepository.getBatchRunCountForScenarioSet"
      );
      expect(call).toBeDefined();
      expect(call!.options.kind).toBe(SpanKind.CLIENT);
      expect(call!.options.attributes["db.system"]).toBe("elasticsearch");
      expect(call!.options.attributes["db.operation"]).toBe("SEARCH");
      expect(call!.options.attributes["tenant.id"]).toBe("proj_3");
      expect(call!.options.attributes["scenario.set.id"]).toBe("set_3");
      expect(call!.span.setAttribute).toHaveBeenCalledWith("result.count", 0);
    });
  });

  describe("when getScenarioRunIdsForBatchRun is called", () => {
    it("creates a span with correct name and attributes", async () => {
      await repo.getScenarioRunIdsForBatchRun({
        projectId: "proj_4",
        scenarioSetId: "set_4",
        batchRunId: "batch_4",
      });

      const call = withActiveSpanCalls.find(
        (c) => c.name === "ScenarioEventRepository.getScenarioRunIdsForBatchRun"
      );
      expect(call).toBeDefined();
      expect(call!.options.kind).toBe(SpanKind.CLIENT);
      expect(call!.options.attributes["db.system"]).toBe("elasticsearch");
      expect(call!.options.attributes["db.operation"]).toBe("SEARCH");
      expect(call!.options.attributes["tenant.id"]).toBe("proj_4");
      expect(call!.options.attributes["scenario.set.id"]).toBe("set_4");
      expect(call!.options.attributes["batch.run.id"]).toBe("batch_4");
      expect(call!.span.setAttribute).toHaveBeenCalledWith("result.count", 0);
    });
  });

  describe("when getScenarioRunIdsForBatchRuns is called", () => {
    it("creates a span with correct name and attributes", async () => {
      await repo.getScenarioRunIdsForBatchRuns({
        projectId: "proj_5",
        batchRunIds: ["batch_5a", "batch_5b"],
      });

      const call = withActiveSpanCalls.find(
        (c) => c.name === "ScenarioEventRepository.getScenarioRunIdsForBatchRuns"
      );
      expect(call).toBeDefined();
      expect(call!.options.kind).toBe(SpanKind.CLIENT);
      expect(call!.options.attributes["db.system"]).toBe("elasticsearch");
      expect(call!.options.attributes["db.operation"]).toBe("SEARCH");
      expect(call!.options.attributes["tenant.id"]).toBe("proj_5");
      expect(call!.options.attributes["batch.run.ids.count"]).toBe(2);
      expect(call!.span.setAttribute).toHaveBeenCalledWith("result.count", 0);
    });
  });

  describe("when getMaxTimestampForBatchRun is called", () => {
    it("creates a span with correct name and attributes", async () => {
      await repo.getMaxTimestampForBatchRun({
        projectId: "proj_6",
        batchRunId: "batch_6",
      });

      const call = withActiveSpanCalls.find(
        (c) => c.name === "ScenarioEventRepository.getMaxTimestampForBatchRun"
      );
      expect(call).toBeDefined();
      expect(call!.options.kind).toBe(SpanKind.CLIENT);
      expect(call!.options.attributes["db.system"]).toBe("elasticsearch");
      expect(call!.options.attributes["db.operation"]).toBe("SEARCH");
      expect(call!.options.attributes["tenant.id"]).toBe("proj_6");
      expect(call!.options.attributes["batch.run.id"]).toBe("batch_6");
      expect(call!.span.setAttribute).toHaveBeenCalledWith("result.timestamp", 0);
    });
  });
});
