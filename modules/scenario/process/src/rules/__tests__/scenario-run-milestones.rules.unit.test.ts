/**
 * A scenario run counts as succeeded only against a connected agent, and
 * only once it left an ungraded status behind.
 * @see specs/features/customer-io-nurturing-integration.feature
 */
import { createTenantId } from "@langwatch/eventing";
import {
  SIMULATION_EVENT_VERSIONS,
  SIMULATION_RUN_EVENT_TYPES,
  type SimulationRunFinishedEvent,
  type SimulationRunStartedEvent,
} from "@langwatch/scenario-contract";
import { describe, expect, it } from "vitest";

import { isConnectedAgentRunSucceeded } from "../scenario-run-milestones.rules.ts";

function finishedEvent(
  data: Partial<SimulationRunFinishedEvent["data"]> = {},
): SimulationRunFinishedEvent {
  return {
    id: "event-1",
    aggregateId: "run-1",
    aggregateType: "simulation_run",
    tenantId: createTenantId("project-1"),
    createdAt: 0,
    occurredAt: 0,
    type: SIMULATION_RUN_EVENT_TYPES.FINISHED,
    version: SIMULATION_EVENT_VERSIONS.FINISHED,
    data: {
      scenarioRunId: "run-1",
      scenarioId: "scenario-1",
      target: { type: "connected", referenceId: "agent-1" },
      results: { verdict: "success", metCriteria: [], unmetCriteria: [] },
      status: "SUCCESS",
      ...data,
    },
  };
}

function startedEvent(): SimulationRunStartedEvent {
  return {
    id: "event-1",
    aggregateId: "run-1",
    aggregateType: "simulation_run",
    tenantId: createTenantId("project-1"),
    createdAt: 0,
    occurredAt: 0,
    type: SIMULATION_RUN_EVENT_TYPES.STARTED,
    version: SIMULATION_EVENT_VERSIONS.STARTED,
    data: {
      scenarioRunId: "run-1",
      scenarioId: "scenario-1",
      batchRunId: "batch-1",
      scenarioSetId: "set-1",
    },
  };
}

describe("isConnectedAgentRunSucceeded()", () => {
  describe("when a run against a connected agent finishes with the verdict success", () => {
    /** @scenario "a scenario run that finished against a connected agent is tracked as succeeded" */
    it("counts as succeeded", () => {
      expect(isConnectedAgentRunSucceeded(finishedEvent())).toBe(true);
    });
  });

  describe("when the judge failed the agent", () => {
    /** @scenario "a scenario run whose verdict is failed still counts as succeeded" */
    it("still counts as succeeded", () => {
      expect(
        isConnectedAgentRunSucceeded(
          finishedEvent({
            results: { verdict: "failure", metCriteria: [], unmetCriteria: [] },
            status: "FAILED",
          }),
        ),
      ).toBe(true);
    });

    it("counts a verdict of failure with no explicit status", () => {
      expect(
        isConnectedAgentRunSucceeded(
          finishedEvent({
            results: { verdict: "failure", metCriteria: [], unmetCriteria: [] },
            status: undefined,
          }),
        ),
      ).toBe(true);
    });
  });

  describe("when the run ended in an error", () => {
    /** @scenario "a scenario run that ended in an error is not tracked as succeeded" */
    it("does not count as succeeded", () => {
      expect(
        isConnectedAgentRunSucceeded(
          finishedEvent({
            results: {
              verdict: "inconclusive",
              metCriteria: [],
              unmetCriteria: [],
              error: "target unreachable",
            },
            status: "ERROR",
          }),
        ),
      ).toBe(false);
    });

    it("counts neither a cancelled run nor an inconclusive one without a status", () => {
      expect(isConnectedAgentRunSucceeded(finishedEvent({ status: "CANCELLED" }))).toBe(false);
      expect(
        isConnectedAgentRunSucceeded(
          finishedEvent({
            results: { verdict: "inconclusive", metCriteria: [], unmetCriteria: [] },
            status: undefined,
          }),
        ),
      ).toBe(false);
    });
  });

  describe("when the run was not against a connected agent", () => {
    /** @scenario "a scenario run against anything but a connected agent is not tracked as succeeded" */
    it("does not count for a prompt target or a run without a target", () => {
      expect(
        isConnectedAgentRunSucceeded(
          finishedEvent({ target: { type: "prompt", referenceId: "prompt-1" } }),
        ),
      ).toBe(false);
      expect(isConnectedAgentRunSucceeded(finishedEvent({ target: undefined }))).toBe(false);
    });
  });

  describe("when the event is not a finished event", () => {
    it("does not count as succeeded", () => {
      expect(isConnectedAgentRunSucceeded(startedEvent())).toBe(false);
    });
  });
});
