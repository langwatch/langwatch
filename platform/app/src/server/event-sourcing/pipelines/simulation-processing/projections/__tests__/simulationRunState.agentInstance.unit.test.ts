/**
 * The served agent instance folded into a run's metadata.
 *
 * @see specs/scenarios/served-agent-instance-on-runs.feature
 */

import { describe, expect, it } from "vitest";
import { createTenantId } from "../../../../domain/tenantId";
import type { FoldProjectionStore } from "../../../../projections/foldProjection.types";
import {
  SIMULATION_EVENT_VERSIONS,
  SIMULATION_RUN_EVENT_TYPES,
} from "../../schemas/constants";
import type {
  SimulationProcessingEvent,
  SimulationRunAgentInstanceRecordedEvent,
  SimulationRunFinishedEvent,
  SimulationRunQueuedEvent,
} from "../../schemas/events";
import {
  type SimulationRunStateData,
  SimulationRunStateFoldProjection,
  withAgentInstance,
} from "../simulationRunState.foldProjection";

const noopStore: FoldProjectionStore<SimulationRunStateData> = {
  store: async () => {},
  get: async () => null,
};
const foldProjection = new SimulationRunStateFoldProjection({
  store: noopStore,
});

const TENANT_ID = createTenantId("tenant-1");
const RUN_ID = "scenario-run-1";

const INSTANCE = { hostname: "worker-1", label: "blue" };

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
        metCriteria: ["Refunds the second charge"],
        unmetCriteria: [],
      },
    },
  };
}

function recorded(): SimulationRunAgentInstanceRecordedEvent {
  return {
    id: "event-recorded",
    aggregateId: RUN_ID,
    aggregateType: "simulation_run",
    tenantId: TENANT_ID,
    createdAt: 3100,
    occurredAt: 3100,
    type: SIMULATION_RUN_EVENT_TYPES.AGENT_INSTANCE_RECORDED,
    version: SIMULATION_EVENT_VERSIONS.AGENT_INSTANCE_RECORDED,
    data: { scenarioRunId: RUN_ID, agentInstance: INSTANCE },
  };
}

function fold(events: SimulationProcessingEvent[]): SimulationRunStateData {
  let state = foldProjection.init();
  for (const event of events) state = foldProjection.apply(state, event);
  return state;
}

describe("withAgentInstance", () => {
  describe("when the metadata already holds the reserved namespace", () => {
    /** @scenario "The instance is written into the run metadata beside what the run already carries" */
    it("adds the instance and keeps everything else", () => {
      const metadata = JSON.stringify({
        parameters: { model: "gpt-5-mini" },
        langwatch: {
          targetKey: "agent_1#abcd1234",
          resolvedJudgeModel: "openai/gpt-5-mini",
        },
      });

      expect(
        JSON.parse(withAgentInstance({ metadata, agentInstance: INSTANCE })),
      ).toEqual({
        parameters: { model: "gpt-5-mini" },
        langwatch: {
          targetKey: "agent_1#abcd1234",
          resolvedJudgeModel: "openai/gpt-5-mini",
          agentInstance: INSTANCE,
        },
      });
    });
  });

  describe("when the run carries no metadata", () => {
    it("writes the namespace with the instance alone", () => {
      expect(
        JSON.parse(
          withAgentInstance({ metadata: null, agentInstance: INSTANCE }),
        ),
      ).toEqual({ langwatch: { agentInstance: INSTANCE } });
    });
  });

  describe("when the metadata does not parse", () => {
    it("writes the namespace with the instance alone", () => {
      expect(
        JSON.parse(
          withAgentInstance({ metadata: "{not json", agentInstance: INSTANCE }),
        ),
      ).toEqual({ langwatch: { agentInstance: INSTANCE } });
    });
  });
});

describe("simulationRunStateFoldProjection", () => {
  describe("when the instance is recorded after the run finished", () => {
    /** @scenario "Recording the instance after the run finished keeps the run finished" */
    it("keeps the terminal state and writes the instance into the metadata", () => {
      const before = fold([
        queued({ langwatch: { targetReferenceId: "agent_1" } }),
        finished(),
      ]);
      const after = foldProjection.apply(before, recorded());

      expect(after.Status).toBe("SUCCESS");
      expect(after.Verdict).toBe("success");
      expect(after.FinishedAt).toBe(before.FinishedAt);
      expect(JSON.parse(after.Metadata ?? "null")).toEqual({
        langwatch: { targetReferenceId: "agent_1", agentInstance: INSTANCE },
      });
    });

    it("folds the same record twice to the same state", () => {
      const once = fold([queued(), finished(), recorded()]);
      const twice = foldProjection.apply(once, recorded());

      expect(twice.Metadata).toBe(once.Metadata);
    });
  });
});
