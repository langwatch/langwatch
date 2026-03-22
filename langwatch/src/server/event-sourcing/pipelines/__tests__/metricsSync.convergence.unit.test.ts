/**
 * Convergence tests for the dual-reactor metrics sync.
 *
 * Verifies that per-role cost/latency metrics propagate correctly
 * regardless of whether traces or scenario events arrive first.
 *
 * Uses mock stores to test the reactor logic without testcontainers.
 *
 * @see specs/features/suites/trace-role-cost-accumulation.feature
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { createSimulationMetricsSyncReactor } from "../trace-processing/reactors/simulationMetricsSync.reactor";
import { createTraceMetricsSyncReactor } from "../simulation-processing/reactors/traceMetricsSync.reactor";
import { createTenantId } from "../../domain/tenantId";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { SimulationRunStateData } from "../simulation-processing/projections/simulationRunState.foldProjection";
import type { UpdateRunMetricsCommandData } from "../simulation-processing/schemas/commands";
import {
  SPAN_RECEIVED_EVENT_TYPE,
  SPAN_RECEIVED_EVENT_VERSION_LATEST,
} from "../trace-processing/schemas/constants";
import {
  SIMULATION_PROCESSING_EVENT_TYPES,
} from "../simulation-processing/schemas/constants";

const TEST_TENANT = createTenantId("tenant-convergence");
const TRACE_ID = "trace-conv-001";
const SCENARIO_RUN_ID = "scenariorun_conv_001";
const BATCH_RUN_ID = "batch-conv-001";

// Captured metrics from dispatched updateRunMetrics calls
let capturedMetrics: UpdateRunMetricsCommandData[] = [];
const mockUpdateRunMetrics = vi.fn(async (data: UpdateRunMetricsCommandData) => {
  capturedMetrics.push(data);
});

function makeTraceSummary(overrides: Partial<TraceSummaryData> = {}): TraceSummaryData {
  return {
    traceId: TRACE_ID,
    spanCount: 3,
    totalDurationMs: 4000,
    computedIOSchemaVersion: "2025-12-18",
    computedInput: null,
    computedOutput: null,
    timeToFirstTokenMs: null,
    timeToLastTokenMs: null,
    tokensPerSecond: null,
    containsErrorStatus: false,
    containsOKStatus: true,
    errorMessage: null,
    models: ["gpt-5-mini"],
    totalCost: 0.003,
    tokensEstimated: false,
    totalPromptTokenCount: 200,
    totalCompletionTokenCount: 100,
    outputFromRootSpan: true,
    outputSpanEndTimeMs: 1000,
    blockedByGuardrail: false,
    topicId: null,
    subTopicId: null,
    hasAnnotation: null,
    attributes: {
      "langwatch.scenario.run_id": SCENARIO_RUN_ID,
    },
    roleCosts: { Agent: 0.003 },
    roleLatencies: { Agent: 4000 },
    spanRoles: { "span-agent": "Agent", "span-llm-1": "Agent", "span-llm-2": "Agent" },
    occurredAt: 1000,
    createdAt: 1000,
    updatedAt: 2000,
    ...overrides,
  };
}

function makeSimulationRunState(overrides: Partial<SimulationRunStateData> = {}): SimulationRunStateData {
  return {
    ScenarioRunId: SCENARIO_RUN_ID,
    ScenarioId: "scenario-1",
    BatchRunId: BATCH_RUN_ID,
    ScenarioSetId: "set-1",
    Status: "SUCCESS",
    Name: "convergence test",
    Description: null,
    Metadata: null,
    Messages: [],
    TraceIds: [TRACE_ID],
    Verdict: null,
    Reasoning: null,
    MetCriteria: [],
    UnmetCriteria: [],
    Error: null,
    DurationMs: null,
    TotalCost: null,
    RoleCosts: {},
    RoleLatencies: {},
    TraceMetrics: {},
    StartedAt: 1000,
    QueuedAt: null,
    CreatedAt: 1000,
    UpdatedAt: 2000,
    FinishedAt: 3000,
    ArchivedAt: null,
    LastSnapshotOccurredAt: 1000,
    ...overrides,
  };
}

describe("Dual-reactor metrics convergence", () => {
  beforeEach(() => {
    capturedMetrics = [];
    mockUpdateRunMetrics.mockClear();
  });

  describe("when trace arrives AFTER scenario events (most common)", () => {
    it("trace-side reactor dispatches metrics using scenario_run_id from span attrs", async () => {
      // The simulation fold already exists (events arrived first).
      // Trace-side reactor fires when trace summary is ready.
      const traceSideReactor = createSimulationMetricsSyncReactor({
        updateRunMetrics: mockUpdateRunMetrics,
      });

      const traceSummary = makeTraceSummary();

      await traceSideReactor.handle(
        {
          id: "evt-1",
          aggregateId: TRACE_ID,
          aggregateType: "trace",
          tenantId: TEST_TENANT,
          createdAt: 1000,
          occurredAt: 1000,
          type: SPAN_RECEIVED_EVENT_TYPE,
          version: SPAN_RECEIVED_EVENT_VERSION_LATEST,
          data: { span: {} as any, resource: null, instrumentationScope: null, piiRedactionLevel: "DISABLED" },
          metadata: { spanId: "span-1", traceId: TRACE_ID },
        },
        {
          tenantId: TEST_TENANT,
          aggregateId: TRACE_ID,
          foldState: traceSummary,
        },
      );

      expect(mockUpdateRunMetrics).toHaveBeenCalledTimes(1);
      expect(capturedMetrics[0]).toMatchObject({
        scenarioRunId: SCENARIO_RUN_ID,
        traceId: TRACE_ID,
        totalCost: 0.003,
        roleCosts: { Agent: 0.003 },
        roleLatencies: { Agent: 4000 },
      });
    });
  });

  describe("when trace arrives BEFORE scenario events", () => {
    it("simulation-side reactor reads trace summary and dispatches metrics", async () => {
      // Trace summary is already in the store (trace arrived first).
      // Simulation-side reactor fires when simulation events arrive.
      const mockTraceSummaryStore = {
        get: vi.fn().mockResolvedValue(makeTraceSummary()),
      };

      const simSideReactor = createTraceMetricsSyncReactor({
        traceSummaryStore: mockTraceSummaryStore as any,
        updateRunMetrics: mockUpdateRunMetrics,
      });

      const simState = makeSimulationRunState();

      // Simulate a message_snapshot event arriving
      await simSideReactor.handle(
        {
          id: "sim-evt-1",
          aggregateId: SCENARIO_RUN_ID,
          aggregateType: "simulation_run",
          tenantId: TEST_TENANT,
          createdAt: 2000,
          occurredAt: 2000,
          type: "lw.simulation_run.message_snapshot",
          version: "2025-02-01",
          data: {
            scenarioRunId: SCENARIO_RUN_ID,
            scenarioId: "scenario-1",
            batchRunId: BATCH_RUN_ID,
            scenarioSetId: "set-1",
            messages: [],
            traceIds: [TRACE_ID],
          },
        } as any,
        {
          tenantId: TEST_TENANT,
          aggregateId: SCENARIO_RUN_ID,
          foldState: simState,
        },
      );

      expect(mockTraceSummaryStore.get).toHaveBeenCalledWith(
        TRACE_ID,
        expect.objectContaining({ tenantId: TEST_TENANT }),
      );
      expect(mockUpdateRunMetrics).toHaveBeenCalledTimes(1);
      expect(capturedMetrics[0]).toMatchObject({
        scenarioRunId: SCENARIO_RUN_ID,
        traceId: TRACE_ID,
        totalCost: 0.003,
        roleCosts: { Agent: 0.003 },
        roleLatencies: { Agent: 4000 },
      });
    });
  });

  describe("when simulation-side fires but trace not ready yet", () => {
    it("skips the trace and does not dispatch", async () => {
      const mockTraceSummaryStore = {
        get: vi.fn().mockResolvedValue(null), // trace hasn't arrived
      };

      const simSideReactor = createTraceMetricsSyncReactor({
        traceSummaryStore: mockTraceSummaryStore as any,
        updateRunMetrics: mockUpdateRunMetrics,
      });

      const simState = makeSimulationRunState();

      await simSideReactor.handle(
        {
          id: "sim-evt-2",
          aggregateId: SCENARIO_RUN_ID,
          aggregateType: "simulation_run",
          tenantId: TEST_TENANT,
          createdAt: 2000,
          occurredAt: 2000,
          type: "lw.simulation_run.message_snapshot",
          version: "2025-02-01",
          data: {
            scenarioRunId: SCENARIO_RUN_ID,
            scenarioId: "scenario-1",
            batchRunId: BATCH_RUN_ID,
            scenarioSetId: "set-1",
            messages: [],
            traceIds: [TRACE_ID],
          },
        } as any,
        {
          tenantId: TEST_TENANT,
          aggregateId: SCENARIO_RUN_ID,
          foldState: simState,
        },
      );

      expect(mockUpdateRunMetrics).not.toHaveBeenCalled();
    });
  });

  describe("when trace-side fires but no scenario_run_id on trace", () => {
    it("skips without dispatching (not a scenario trace)", async () => {
      const traceSideReactor = createSimulationMetricsSyncReactor({
        updateRunMetrics: mockUpdateRunMetrics,
      });

      const traceSummary = makeTraceSummary({
        attributes: {}, // no scenario_run_id
      });

      await traceSideReactor.handle(
        {
          id: "evt-2",
          aggregateId: TRACE_ID,
          aggregateType: "trace",
          tenantId: TEST_TENANT,
          createdAt: 1000,
          occurredAt: 1000,
          type: SPAN_RECEIVED_EVENT_TYPE,
          version: SPAN_RECEIVED_EVENT_VERSION_LATEST,
          data: { span: {} as any, resource: null, instrumentationScope: null, piiRedactionLevel: "DISABLED" },
          metadata: { spanId: "span-1", traceId: TRACE_ID },
        },
        {
          tenantId: TEST_TENANT,
          aggregateId: TRACE_ID,
          foldState: traceSummary,
        },
      );

      expect(mockUpdateRunMetrics).not.toHaveBeenCalled();
    });
  });

  describe("idempotent convergence", () => {
    it("both reactors dispatch the same metrics — second dispatch replaces first", async () => {
      // Simulate both reactors firing for the same trace
      const traceSideReactor = createSimulationMetricsSyncReactor({
        updateRunMetrics: mockUpdateRunMetrics,
      });

      const mockTraceSummaryStore = {
        get: vi.fn().mockResolvedValue(makeTraceSummary()),
      };
      const simSideReactor = createTraceMetricsSyncReactor({
        traceSummaryStore: mockTraceSummaryStore as any,
        updateRunMetrics: mockUpdateRunMetrics,
      });

      const traceSummary = makeTraceSummary();
      const simState = makeSimulationRunState();

      // Trace-side fires first
      await traceSideReactor.handle(
        {
          id: "evt-3",
          aggregateId: TRACE_ID,
          aggregateType: "trace",
          tenantId: TEST_TENANT,
          createdAt: 1000,
          occurredAt: 1000,
          type: SPAN_RECEIVED_EVENT_TYPE,
          version: SPAN_RECEIVED_EVENT_VERSION_LATEST,
          data: { span: {} as any, resource: null, instrumentationScope: null, piiRedactionLevel: "DISABLED" },
          metadata: { spanId: "span-1", traceId: TRACE_ID },
        },
        {
          tenantId: TEST_TENANT,
          aggregateId: TRACE_ID,
          foldState: traceSummary,
        },
      );

      // Simulation-side fires second
      await simSideReactor.handle(
        {
          id: "sim-evt-3",
          aggregateId: SCENARIO_RUN_ID,
          aggregateType: "simulation_run",
          tenantId: TEST_TENANT,
          createdAt: 2000,
          occurredAt: 2000,
          type: "lw.simulation_run.message_snapshot",
          version: "2025-02-01",
          data: {
            scenarioRunId: SCENARIO_RUN_ID,
            scenarioId: "scenario-1",
            batchRunId: BATCH_RUN_ID,
            scenarioSetId: "set-1",
            messages: [],
            traceIds: [TRACE_ID],
          },
        } as any,
        {
          tenantId: TEST_TENANT,
          aggregateId: SCENARIO_RUN_ID,
          foldState: simState,
        },
      );

      // Both dispatched — 2 calls total
      expect(mockUpdateRunMetrics).toHaveBeenCalledTimes(2);

      // Both have identical payload (same trace, same metrics)
      expect(capturedMetrics[0]!.scenarioRunId).toBe(SCENARIO_RUN_ID);
      expect(capturedMetrics[1]!.scenarioRunId).toBe(SCENARIO_RUN_ID);
      expect(capturedMetrics[0]!.traceId).toBe(TRACE_ID);
      expect(capturedMetrics[1]!.traceId).toBe(TRACE_ID);
      expect(capturedMetrics[0]!.roleCosts).toEqual({ Agent: 0.003 });
      expect(capturedMetrics[1]!.roleCosts).toEqual({ Agent: 0.003 });
    });
  });

  describe("when simulation-side skips already-synced traces", () => {
    it("does not re-dispatch for traces already in TraceMetrics", async () => {
      const mockTraceSummaryStore = {
        get: vi.fn().mockResolvedValue(makeTraceSummary()),
      };
      const simSideReactor = createTraceMetricsSyncReactor({
        traceSummaryStore: mockTraceSummaryStore as any,
        updateRunMetrics: mockUpdateRunMetrics,
      });

      // TraceMetrics already has this trace (synced by trace-side reactor earlier)
      const simState = makeSimulationRunState({
        TraceMetrics: {
          [TRACE_ID]: { totalCost: 0.003, roleCosts: { Agent: 0.003 }, roleLatencies: { Agent: 4000 } },
        },
      });

      await simSideReactor.handle(
        {
          id: "sim-evt-4",
          aggregateId: SCENARIO_RUN_ID,
          aggregateType: "simulation_run",
          tenantId: TEST_TENANT,
          createdAt: 2000,
          occurredAt: 2000,
          type: "lw.simulation_run.message_snapshot",
          version: "2025-02-01",
          data: {
            scenarioRunId: SCENARIO_RUN_ID,
            scenarioId: "scenario-1",
            batchRunId: BATCH_RUN_ID,
            scenarioSetId: "set-1",
            messages: [],
            traceIds: [TRACE_ID],
          },
        } as any,
        {
          tenantId: TEST_TENANT,
          aggregateId: SCENARIO_RUN_ID,
          foldState: simState,
        },
      );

      // Should NOT dispatch — trace already in TraceMetrics
      expect(mockUpdateRunMetrics).not.toHaveBeenCalled();
      // Should NOT even query the store
      expect(mockTraceSummaryStore.get).not.toHaveBeenCalled();
    });
  });
});
