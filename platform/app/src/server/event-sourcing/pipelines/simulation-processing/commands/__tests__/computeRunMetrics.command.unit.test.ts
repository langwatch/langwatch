import { describe, expect, it, vi } from "vitest";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { Command } from "../../../../";
import type { SimulationRunStateData } from "../../projections/simulationRunState.foldProjection";
import type { ComputeRunMetricsCommandData } from "../../schemas/commands";
import { SIMULATION_RUN_EVENT_TYPES } from "../../schemas/constants";
import type { ComputeRunMetricsDeps } from "../computeRunMetrics.command";
import { ComputeRunMetricsCommand } from "../computeRunMetrics.command";

/** Only the fields the command reads; the rest of the fold is irrelevant here. */
function makeRun(
  overrides: Partial<SimulationRunStateData> = {},
): SimulationRunStateData {
  return {
    ScenarioRunId: "run-1",
    TraceIds: ["trace-1"],
    ArchivedAt: null,
    ...overrides,
  } as SimulationRunStateData;
}

function runStoreOf(run: SimulationRunStateData | null) {
  return { get: vi.fn().mockResolvedValue(run), store: vi.fn() };
}

function makeDeps(
  overrides: Partial<ComputeRunMetricsDeps> = {},
): ComputeRunMetricsDeps {
  return {
    simulationRunStore: runStoreOf(makeRun()),
    traceSummaryStore: {
      get: vi.fn().mockResolvedValue(null),
      store: vi.fn().mockResolvedValue(undefined),
    },
    deriveScenarioRoleMetrics: vi
      .fn()
      .mockResolvedValue({ scenarioRoleCosts: {}, scenarioRoleLatencies: {} }),
    ...overrides,
  };
}

function makeCommand(
  overrides: Partial<ComputeRunMetricsCommandData> = {},
): Command<ComputeRunMetricsCommandData> {
  return {
    tenantId: "tenant-1",
    data: {
      tenantId: "tenant-1",
      scenarioRunId: "run-1",
      occurredAt: 1_700_000_000_000,
      ...overrides,
    },
  } as Command<ComputeRunMetricsCommandData>;
}

function makeTraceSummary(
  overrides: Partial<TraceSummaryData> = {},
): TraceSummaryData {
  return {
    traceId: "trace-1",
    traceName: "",
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
    models: [],
    totalCost: 0.003,
    nonBilledCost: null,
    tokensEstimated: false,
    totalPromptTokenCount: null,
    totalCompletionTokenCount: null,
    outputFromRootSpan: false,
    outputSpanEndTimeMs: 0,
    blockedByGuardrail: false,
    rootSpanType: null,
    containsAi: false,
    topicId: null,
    subTopicId: null,
    annotationIds: [],
    containsPrompt: false,
    selectedPromptId: null,
    selectedPromptSpanId: null,
    selectedPromptStartTimeMs: null,
    lastUsedPromptId: null,
    lastUsedPromptVersionNumber: null,
    lastUsedPromptVersionId: null,
    lastUsedPromptSpanId: null,
    lastUsedPromptStartTimeMs: null,
    attributes: {},
    LastEventOccurredAt: 0,
    occurredAt: 1000,
    createdAt: 1000,
    updatedAt: 2000,
    ...overrides,
  };
}

describe("ComputeRunMetricsCommand", () => {
  describe("given a run with a single measurable trace", () => {
    describe("when the trace has a cost and role-bearing spans", () => {
      it("emits one metrics_recorded event carrying the aggregate", async () => {
        const deps = makeDeps({
          traceSummaryStore: {
            get: vi
              .fn()
              .mockResolvedValue(makeTraceSummary({ totalCost: 0.003 })),
            store: vi.fn(),
          },
          deriveScenarioRoleMetrics: vi.fn().mockResolvedValue({
            scenarioRoleCosts: { Agent: 0.003 },
            scenarioRoleLatencies: { Agent: 4000 },
          }),
        });

        const events = await new ComputeRunMetricsCommand(deps).handle(
          makeCommand(),
        );

        expect(events).toHaveLength(1);
        expect(events[0]!.type).toBe(
          SIMULATION_RUN_EVENT_TYPES.METRICS_RECORDED,
        );
        expect(events[0]!.data).toEqual({
          scenarioRunId: "run-1",
          traceIds: ["trace-1"],
          totalCost: 0.003,
          roleCosts: { Agent: [0.003] },
          roleLatencies: { Agent: [4000] },
        });
      });

      it("passes the summary's partition hint and fold watermark to the derivation", async () => {
        const deps = makeDeps({
          traceSummaryStore: {
            get: vi
              .fn()
              .mockResolvedValue(
                makeTraceSummary({ occurredAt: 1234, spanCount: 7 }),
              ),
            store: vi.fn(),
          },
          deriveScenarioRoleMetrics: vi.fn().mockResolvedValue({
            scenarioRoleCosts: { Agent: 0.003 },
            scenarioRoleLatencies: {},
          }),
        });

        await new ComputeRunMetricsCommand(deps).handle(makeCommand());

        expect(deps.deriveScenarioRoleMetrics).toHaveBeenCalledWith({
          tenantId: "tenant-1",
          traceId: "trace-1",
          occurredAtMs: 1234,
          foldVersion: 7,
        });
      });
    });

    describe("when the trace has role latency but no cost", () => {
      it("records the latency with a null total cost", async () => {
        const deps = makeDeps({
          traceSummaryStore: {
            get: vi
              .fn()
              .mockResolvedValue(makeTraceSummary({ totalCost: null })),
            store: vi.fn(),
          },
          deriveScenarioRoleMetrics: vi.fn().mockResolvedValue({
            scenarioRoleCosts: {},
            scenarioRoleLatencies: { Agent: 4000 },
          }),
        });

        const events = await new ComputeRunMetricsCommand(deps).handle(
          makeCommand(),
        );

        expect(events).toHaveLength(1);
        expect(events[0]!.data).toMatchObject({
          totalCost: null,
          roleCosts: {},
          roleLatencies: { Agent: [4000] },
        });
      });
    });

    describe("when no trace summary exists yet", () => {
      it("still derives role metrics from the stored spans", async () => {
        const deps = makeDeps({
          deriveScenarioRoleMetrics: vi.fn().mockResolvedValue({
            scenarioRoleCosts: {},
            scenarioRoleLatencies: { Agent: 1500 },
          }),
        });

        const events = await new ComputeRunMetricsCommand(deps).handle(
          makeCommand(),
        );

        expect(events).toHaveLength(1);
        expect(events[0]!.data).toMatchObject({
          totalCost: null,
          roleLatencies: { Agent: [1500] },
        });
      });
    });
  });

  describe("given a run with several traces", () => {
    const summaries: Record<string, number> = {
      "trace-1": 0.002,
      "trace-2": 0.004,
    };
    const roleMetrics: Record<
      string,
      {
        scenarioRoleCosts: Record<string, number>;
        scenarioRoleLatencies: Record<string, number>;
      }
    > = {
      "trace-1": {
        scenarioRoleCosts: { Agent: 0.002 },
        scenarioRoleLatencies: { Agent: 1000, User: 200 },
      },
      "trace-2": {
        scenarioRoleCosts: { Agent: 0.004 },
        scenarioRoleLatencies: { Agent: 3000 },
      },
    };

    describe("when each trace contributes cost and latency", () => {
      it("sums the cost and keeps one array entry per trace", async () => {
        const deps = makeDeps({
          simulationRunStore: runStoreOf(
            makeRun({ TraceIds: ["trace-1", "trace-2"] }),
          ),
          traceSummaryStore: {
            get: vi.fn(async (traceId: string) =>
              makeTraceSummary({ traceId, totalCost: summaries[traceId]! }),
            ),
            store: vi.fn(),
          },
          deriveScenarioRoleMetrics: vi.fn(
            async ({ traceId }: { traceId: string }) => roleMetrics[traceId]!,
          ),
        });

        const events = await new ComputeRunMetricsCommand(deps).handle(
          makeCommand(),
        );

        expect(events[0]!.data).toEqual({
          scenarioRunId: "run-1",
          traceIds: ["trace-1", "trace-2"],
          totalCost: 0.006,
          roleCosts: { Agent: [0.002, 0.004] },
          roleLatencies: { Agent: [1000, 3000], User: [200] },
        });
      });

      it("orders the aggregated arrays by the run's traceIds, not by read completion", async () => {
        const delays: Record<string, number> = { "trace-1": 20, "trace-2": 0 };
        const costs: Record<string, number> = { "trace-1": 1, "trace-2": 2 };

        const deps = makeDeps({
          simulationRunStore: runStoreOf(
            makeRun({ TraceIds: ["trace-1", "trace-2"] }),
          ),
          traceSummaryStore: {
            get: vi.fn(
              (traceId: string) =>
                new Promise((resolve) =>
                  setTimeout(
                    () => resolve(makeTraceSummary({ traceId, totalCost: 0 })),
                    delays[traceId],
                  ),
                ),
            ),
            store: vi.fn(),
          },
          deriveScenarioRoleMetrics: vi.fn(
            async ({ traceId }: { traceId: string }) => ({
              scenarioRoleCosts: { Agent: costs[traceId]! },
              scenarioRoleLatencies: {},
            }),
          ),
        });

        const events = await new ComputeRunMetricsCommand(deps).handle(
          makeCommand(),
        );

        expect(events[0]!.data).toMatchObject({ roleCosts: { Agent: [1, 2] } });
      });
    });
  });

  describe("given the run's traces are read at measure time", () => {
    describe("when a trace landed after the run finished", () => {
      it("measures it too, because the trace list comes from the stored run", async () => {
        const deps = makeDeps({
          simulationRunStore: runStoreOf(
            makeRun({ TraceIds: ["trace-1", "late-trace"] }),
          ),
          traceSummaryStore: {
            get: vi.fn(async (traceId: string) =>
              makeTraceSummary({ traceId, totalCost: 0.001 }),
            ),
            store: vi.fn(),
          },
        });

        const events = await new ComputeRunMetricsCommand(deps).handle(
          makeCommand(),
        );

        expect(events[0]!.data).toMatchObject({
          traceIds: ["trace-1", "late-trace"],
          totalCost: 0.002,
        });
      });
    });
  });

  describe("given nothing measurable came back", () => {
    describe("when no trace reports a cost and no span carries a role", () => {
      it("emits no event rather than blanking the run's stored metrics", async () => {
        const deps = makeDeps({
          traceSummaryStore: {
            get: vi
              .fn()
              .mockResolvedValue(makeTraceSummary({ totalCost: null })),
            store: vi.fn(),
          },
        });

        const events = await new ComputeRunMetricsCommand(deps).handle(
          makeCommand(),
        );

        expect(events).toEqual([]);
      });
    });

    describe("when the run produced no traces at all", () => {
      it("reads no traces and emits nothing", async () => {
        const deps = makeDeps({
          simulationRunStore: runStoreOf(makeRun({ TraceIds: [] })),
        });

        const events = await new ComputeRunMetricsCommand(deps).handle(
          makeCommand(),
        );

        expect(events).toEqual([]);
        expect(deps.traceSummaryStore.get).not.toHaveBeenCalled();
        expect(deps.deriveScenarioRoleMetrics).not.toHaveBeenCalled();
      });
    });

    describe("when nothing has been folded for the run", () => {
      it("emits nothing", async () => {
        const deps = makeDeps({ simulationRunStore: runStoreOf(null) });

        const events = await new ComputeRunMetricsCommand(deps).handle(
          makeCommand(),
        );

        expect(events).toEqual([]);
        expect(deps.deriveScenarioRoleMetrics).not.toHaveBeenCalled();
      });
    });
  });

  describe("given the run was deleted during the settle period", () => {
    describe("when the measurement runs", () => {
      it("spends no reads and emits nothing", async () => {
        const deps = makeDeps({
          simulationRunStore: runStoreOf(makeRun({ ArchivedAt: 9_999 })),
        });

        const events = await new ComputeRunMetricsCommand(deps).handle(
          makeCommand(),
        );

        expect(events).toEqual([]);
        expect(deps.traceSummaryStore.get).not.toHaveBeenCalled();
        expect(deps.deriveScenarioRoleMetrics).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a trace read fails", () => {
    describe("when the derivation rejects", () => {
      it("propagates so the queue retries instead of recording a partial run", async () => {
        const deps = makeDeps({
          deriveScenarioRoleMetrics: vi
            .fn()
            .mockRejectedValue(new Error("clickhouse unavailable")),
        });

        await expect(
          new ComputeRunMetricsCommand(deps).handle(makeCommand()),
        ).rejects.toThrow("clickhouse unavailable");
      });
    });
  });

  describe("given the same run is measured twice", () => {
    function depsProducing(cost: number): ComputeRunMetricsDeps {
      return makeDeps({
        traceSummaryStore: {
          get: vi.fn().mockResolvedValue(makeTraceSummary({ totalCost: cost })),
          store: vi.fn(),
        },
        deriveScenarioRoleMetrics: vi.fn().mockResolvedValue({
          scenarioRoleCosts: { Agent: cost },
          scenarioRoleLatencies: {},
        }),
      });
    }

    describe("when both measurements produce the same values", () => {
      it("reuses the idempotency key so the second collapses onto the first", async () => {
        const first = await new ComputeRunMetricsCommand(
          depsProducing(0.003),
        ).handle(makeCommand());
        const second = await new ComputeRunMetricsCommand(
          depsProducing(0.003),
        ).handle(makeCommand({ occurredAt: 1_700_000_600_000 }));

        expect(second[0]!.idempotencyKey).toBe(first[0]!.idempotencyKey);
      });
    });

    describe("when the second measurement corrects the first", () => {
      it("takes a different idempotency key so the correction is not discarded", async () => {
        const first = await new ComputeRunMetricsCommand(
          depsProducing(0),
        ).handle(makeCommand());
        const corrected = await new ComputeRunMetricsCommand(
          depsProducing(0.004),
        ).handle(makeCommand({ occurredAt: 1_700_000_600_000 }));

        expect(corrected[0]!.idempotencyKey).not.toBe(first[0]!.idempotencyKey);
      });
    });

    describe("when the same values arrive with role keys in a different order", () => {
      it("fingerprints them alike", async () => {
        const build = (roleCosts: Record<string, number>) =>
          new ComputeRunMetricsCommand(
            makeDeps({
              traceSummaryStore: {
                get: vi
                  .fn()
                  .mockResolvedValue(makeTraceSummary({ totalCost: 0.003 })),
                store: vi.fn(),
              },
              deriveScenarioRoleMetrics: vi.fn().mockResolvedValue({
                scenarioRoleCosts: roleCosts,
                scenarioRoleLatencies: {},
              }),
            }),
          ).handle(makeCommand());

        const [ab] = await build({ Agent: 0.001, User: 0.002 });
        const [ba] = await build({ User: 0.002, Agent: 0.001 });

        expect(ba!.idempotencyKey).toBe(ab!.idempotencyKey);
      });
    });
  });
});
