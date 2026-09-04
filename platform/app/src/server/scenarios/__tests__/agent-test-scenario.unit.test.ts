/**
 * @vitest-environment node
 *
 * The identity of an agent test run: its set id, its scenario id and the
 * scenario the child receives.
 *
 * @see specs/agents/agent-test-run.feature
 */

import { describe, expect, it } from "vitest";
import { isSuiteSetId } from "../../suites/suite-set-id";
import {
  AGENT_TEST_SCENARIO_ID,
  AGENT_TEST_USER_MESSAGE,
  agentTestScenarioConfig,
  getAgentTestSetId,
  isAgentTestScenarioId,
  isAgentTestSetId,
} from "../agent-test-scenario";
import { isInternalSetId, isOnPlatformSet } from "../internal-set-id";

describe("agent test scenario", () => {
  describe("given the set id of a project's agent tests", () => {
    const setId = getAgentTestSetId("proj_1");

    /** @scenario "The agent test set is an internal set" */
    it("is an internal set, an agent test set, and no other kind", () => {
      expect(setId).toBe("__internal__proj_1__agent-test");
      expect(isInternalSetId(setId)).toBe(true);
      expect(isAgentTestSetId(setId)).toBe(true);
      expect(isSuiteSetId(setId)).toBe(false);
      expect(isOnPlatformSet(setId)).toBe(false);
    });

    it("leaves the other internal sets alone", () => {
      expect(isAgentTestSetId("__internal__suite_1__suite")).toBe(false);
      expect(
        isAgentTestSetId("__internal__proj_1__on-platform-scenarios"),
      ).toBe(false);
      expect(isAgentTestSetId("default")).toBe(false);
    });
  });

  describe("given the scenario id of an agent test", () => {
    it("is recognized, and no saved scenario id is", () => {
      expect(isAgentTestScenarioId(AGENT_TEST_SCENARIO_ID)).toBe(true);
      expect(isAgentTestScenarioId("scenario_abc")).toBe(false);
    });
  });

  describe("when the scenario of a test run is built", () => {
    /** @scenario "The queued run names the agent" */
    it("names the agent, sends ping, and declares no criteria", () => {
      const scenario = agentTestScenarioConfig({ agentName: "support-agent" });
      expect(scenario.id).toBe(AGENT_TEST_SCENARIO_ID);
      expect(scenario.name).toBe("Test support-agent");
      expect(scenario.situation).toContain(`"${AGENT_TEST_USER_MESSAGE}"`);
      expect(scenario.criteria).toEqual([]);
      expect(scenario.labels).toEqual([]);
    });
  });
});
