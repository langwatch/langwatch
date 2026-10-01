// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * A scenario run counts as succeeded only against a connected agent, and
 * only once it left an ungraded status behind.
 * @see specs/features/customer-io-nurturing-integration.feature
 */
import type { SimulationRunFinishedEventData } from "@langwatch/scenario-contract";
import { describe, expect, it } from "vitest";

import { isConnectedAgentRunSucceeded } from "../nurturing-scenario-run.rules.ts";

function finishedEvent(
  data: Partial<SimulationRunFinishedEventData> = {},
): SimulationRunFinishedEventData {
  return {
    scenarioRunId: "run-1",
    scenarioId: "scenario-1",
    target: { type: "connected", referenceId: "agent-1" },
    results: { verdict: "success", metCriteria: [], unmetCriteria: [] },
    status: "SUCCESS",
    ...data,
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
});
