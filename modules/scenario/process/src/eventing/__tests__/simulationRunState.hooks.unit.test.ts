/**
 * A run's setup and teardown results folded into its metadata (ADR-180).
 *
 * @see modules/scenario/specs/scenario-run-hooks.feature
 */

import { createTenantId } from "@langwatch/eventing";
import type { FoldProjectionStore } from "@langwatch/eventing";
import {
  SIMULATION_EVENT_VERSIONS,
  SIMULATION_RUN_EVENT_TYPES,
} from "@langwatch/scenario-contract";
import type {
  ScenarioRunHooks,
  SimulationProcessingEvent,
  SimulationRunHooksRecordedEvent,
  SimulationRunFinishedEvent,
  SimulationRunQueuedEvent,
} from "@langwatch/scenario-contract";
import { describe, expect, it } from "vitest";

import {
  type SimulationRunStateData,
  SimulationRunStateFoldProjection,
} from "../simulation-run-state.projection.ts";

const noopStore: FoldProjectionStore<SimulationRunStateData> = {
  store: async () => {},
  get: async () => ({ kind: "empty" as const }),
};
const foldProjection = SimulationRunStateFoldProjection.create({
  store: noopStore,
});

const TENANT_ID = createTenantId("tenant-1");
const RUN_ID = "scenario-run-1";

function queued(metadata?: Record<string, unknown>): SimulationRunQueuedEvent {
  return {
    id: "event-queued",
    aggregateId: RUN_ID,
    aggregateType: "simulation_run",
    tenantId: TENANT_ID,
    createdAt: 500,
    occurredAt: 500,
    type: SIMULATION_RUN_EVENT_TYPES.QUEUED,
    version: SIMULATION_EVENT_VERSIONS.QUEUED,
    data: {
      scenarioRunId: RUN_ID,
      scenarioId: "scenario-1",
      batchRunId: "batch-1",
      scenarioSetId: "set-1",
      ...(metadata ? { metadata } : {}),
    },
  };
}

function finished(): SimulationRunFinishedEvent {
  return {
    id: "event-finished",
    aggregateId: RUN_ID,
    aggregateType: "simulation_run",
    tenantId: TENANT_ID,
    createdAt: 3000,
    occurredAt: 3000,
    type: SIMULATION_RUN_EVENT_TYPES.FINISHED,
    version: SIMULATION_EVENT_VERSIONS.FINISHED,
    data: {
      scenarioRunId: RUN_ID,
      status: "SUCCESS",
      results: {
        verdict: "success",
        reasoning: "All criteria met",
        metCriteria: ["Answers within the time limit"],
        unmetCriteria: [],
      },
    },
  };
}

const HOOKS: ScenarioRunHooks = {
  setup: { status: "ok", durationMs: 120, traceId: "trace_setup", state: { orderId: "42" } },
  teardown: {
    status: "failed",
    durationMs: 80,
    state: { orderId: "42" },
    error: "Connected agent call failed (agent_call_failed): order locked",
  },
};

function hooksRecorded(): SimulationRunHooksRecordedEvent {
  return {
    id: "event-hooks",
    aggregateId: RUN_ID,
    aggregateType: "simulation_run",
    tenantId: TENANT_ID,
    createdAt: 3100,
    occurredAt: 3100,
    type: SIMULATION_RUN_EVENT_TYPES.HOOKS_RECORDED,
    version: SIMULATION_EVENT_VERSIONS.HOOKS_RECORDED,
    data: { scenarioRunId: RUN_ID, hooks: HOOKS },
  };
}

function fold(events: SimulationProcessingEvent[]): SimulationRunStateData {
  let state = foldProjection.init();
  for (const event of events) state = foldProjection.apply(state, event);
  return state;
}

describe("simulationRunStateFoldProjection hooks", () => {
  describe("when the hook results are recorded after the run finished", () => {
    /** @scenario "Recording hooks after the run finished keeps the run finished" */
    it("keeps the status, the verdict and the finish time", () => {
      const before = fold([queued(), finished()]);
      const after = foldProjection.apply(before, hooksRecorded());

      expect(after.Status).toBe(before.Status);
      expect(after.Verdict).toBe(before.Verdict);
      expect(after.FinishedAt).toBe(before.FinishedAt);
    });

    /** @scenario "Each hook result is recorded on the run" */
    it("writes each hook's status, duration, trace, state and error under langwatch.hooks", () => {
      const after = fold([
        queued({ langwatch: { targetReferenceId: "agent_1" } }),
        finished(),
        hooksRecorded(),
      ]);

      expect(JSON.parse(after.Metadata ?? "null")).toEqual({
        langwatch: { targetReferenceId: "agent_1", hooks: HOOKS },
      });
    });
  });
});
