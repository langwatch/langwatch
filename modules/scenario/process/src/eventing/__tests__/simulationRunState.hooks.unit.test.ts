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

function finished(verdict: "success" | "failure" = "success"): SimulationRunFinishedEvent {
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
      status: verdict === "success" ? "SUCCESS" : "FAILED",
      results: {
        verdict,
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

function hooksRecorded(hooks: ScenarioRunHooks = HOOKS): SimulationRunHooksRecordedEvent {
  return {
    id: "event-hooks",
    aggregateId: RUN_ID,
    aggregateType: "simulation_run",
    tenantId: TENANT_ID,
    createdAt: 3100,
    occurredAt: 3100,
    type: SIMULATION_RUN_EVENT_TYPES.HOOKS_RECORDED,
    version: SIMULATION_EVENT_VERSIONS.HOOKS_RECORDED,
    data: { scenarioRunId: RUN_ID, hooks },
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

    /** @scenario "A run whose setup failed is measured from its queued time" */
    it("measures a run that never started from its queued time", () => {
      const notStarted = fold([queued(), finished("failure")]);
      expect(notStarted.DurationMs).toBeNull();

      const after = foldProjection.apply(notStarted, hooksRecorded());

      expect(after.DurationMs).toBe(3000 - 500);
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

  describe("when the teardown failed", () => {
    /** @scenario "A failed teardown leaves a passing verdict passing" */
    it("leaves a passing run passing", () => {
      const after = fold([queued(), finished("success"), hooksRecorded()]);

      expect(after.Verdict).toBe("success");
      expect(after.Status).toBe("SUCCESS");
    });

    /** @scenario "A failed teardown leaves a failing verdict failing" */
    it("leaves a failing run failing", () => {
      const after = fold([queued(), finished("failure"), hooksRecorded()]);

      expect(after.Verdict).toBe("failure");
      expect(after.Status).toBe("FAILED");
    });
  });

  describe("when the teardown timed out", () => {
    /** @scenario "A teardown that times out counts as failed" */
    it("keeps the verdict and records the timeout", () => {
      const timedOut: ScenarioRunHooks = {
        teardown: { status: "timed_out", durationMs: 60_000, error: "no answer within 60s" },
      };
      const after = fold([queued(), finished("success"), hooksRecorded(timedOut)]);

      expect(after.Verdict).toBe("success");
      expect(JSON.parse(after.Metadata ?? "null").langwatch.hooks).toEqual(timedOut);
    });
  });
});
