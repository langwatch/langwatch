/**
 * The call-limit cutoff marker folded into a simulated run's metadata (#8021).
 *
 * @see specs/features/agents/voice-agents-v1.feature
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
  SimulationRunCutAtLimitRecordedEvent,
  SimulationRunFinishedEvent,
  SimulationRunQueuedEvent,
} from "../../schemas/events";
import {
  type SimulationRunStateData,
  SimulationRunStateFoldProjection,
  withCutAtLimit,
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

function cutAtLimit(): SimulationRunCutAtLimitRecordedEvent {
  return {
    id: "event-cut",
    aggregateId: RUN_ID,
    aggregateType: "simulation_run",
    tenantId: TENANT_ID,
    createdAt: 3100,
    occurredAt: 3100,
    type: SIMULATION_RUN_EVENT_TYPES.CUT_AT_LIMIT_RECORDED,
    version: SIMULATION_EVENT_VERSIONS.CUT_AT_LIMIT_RECORDED,
    data: { scenarioRunId: RUN_ID },
  };
}

function fold(events: SimulationProcessingEvent[]): SimulationRunStateData {
  let state = foldProjection.init();
  for (const event of events) state = foldProjection.apply(state, event);
  return state;
}

describe("withCutAtLimit", () => {
  describe("when the metadata already holds the reserved namespace", () => {
    it("sets the flag and keeps everything else", () => {
      const metadata = JSON.stringify({
        parameters: { model: "gpt-5-mini" },
        langwatch: { targetReferenceId: "agent_1" },
      });

      expect(JSON.parse(withCutAtLimit(metadata))).toEqual({
        parameters: { model: "gpt-5-mini" },
        langwatch: { targetReferenceId: "agent_1", isCutAtLimit: true },
      });
    });
  });

  describe("when the run carries no metadata", () => {
    it("writes the namespace with the flag alone", () => {
      expect(JSON.parse(withCutAtLimit(null))).toEqual({
        langwatch: { isCutAtLimit: true },
      });
    });
  });
});

describe("simulationRunStateFoldProjection cut-at-limit", () => {
  describe("when the cutoff is recorded after the run finished", () => {
    /** @scenario "A simulated voice run cut at the call limit records the cutoff marker" */
    it("keeps the run finished and sets the flag in the read-back metadata", () => {
      const before = fold([
        queued({ langwatch: { targetReferenceId: "agent_1" } }),
        finished(),
      ]);
      const after = foldProjection.apply(before, cutAtLimit());

      expect(after.Status).toBe("SUCCESS");
      expect(JSON.parse(after.Metadata ?? "null")).toEqual({
        langwatch: { targetReferenceId: "agent_1", isCutAtLimit: true },
      });
    });
  });

  describe("when the cutoff is folded twice for the same run", () => {
    /** @scenario "The cutoff marker folded twice sets the flag once" */
    it("sets the flag once, byte-identical metadata", () => {
      const once = fold([queued(), finished(), cutAtLimit()]);
      const twice = foldProjection.apply(once, cutAtLimit());

      expect(twice.Metadata).toBe(once.Metadata);
      expect(JSON.parse(twice.Metadata ?? "null")).toMatchObject({
        langwatch: { isCutAtLimit: true },
      });
    });
  });
});
