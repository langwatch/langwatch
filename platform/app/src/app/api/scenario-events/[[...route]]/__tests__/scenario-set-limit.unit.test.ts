import { beforeEach, describe, expect, it, vi } from "vitest";
import { ScenarioEventType } from "~/server/scenarios/scenario-event.enums";

const { checkScenarioSetLimit, resolveOrganizationId } = vi.hoisted(() => ({
  checkScenarioSetLimit: vi.fn(),
  resolveOrganizationId: vi.fn(),
}));

vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({ usage: { checkScenarioSetLimit } }),
}));

vi.mock("~/server/organizations/resolveOrganizationId", () => ({
  resolveOrganizationId,
}));

import { checkScenarioSetLimitForRunStarted } from "../scenario-set-limit";

const project = { id: "project-1" };

describe("checkScenarioSetLimitForRunStarted", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveOrganizationId.mockResolvedValue("org-acme");
    checkScenarioSetLimit.mockResolvedValue(undefined);
  });

  describe("when a run starts for an external scenario set", () => {
    it("checks the organization's simulation cap", async () => {
      await checkScenarioSetLimitForRunStarted({
        project,
        event: { type: ScenarioEventType.RUN_STARTED, scenarioSetId: "set-a" },
      });

      expect(checkScenarioSetLimit).toHaveBeenCalledWith({
        organizationId: "org-acme",
        scenarioSetId: "set-a",
      });
    });
  });

  describe("when the event is not a run start", () => {
    it("does not check the cap", async () => {
      await checkScenarioSetLimitForRunStarted({
        project,
        event: {
          type: ScenarioEventType.MESSAGE_SNAPSHOT,
          scenarioSetId: "set-a",
        },
      });

      expect(checkScenarioSetLimit).not.toHaveBeenCalled();
    });
  });

  describe("when the run comes from the platform, an agent test or a voice call", () => {
    /** @scenario Platform-owned runs do not count as simulations */
    it.each([
      "__internal__project-1__on-platform-scenarios",
      "__internal__suite-1__suite",
      "agent-1__agent-test",
      "voice-calls",
    ])("does not check the cap for %s", async (scenarioSetId) => {
      await checkScenarioSetLimitForRunStarted({
        project,
        event: { type: ScenarioEventType.RUN_STARTED, scenarioSetId },
      });

      expect(checkScenarioSetLimit).not.toHaveBeenCalled();
    });
  });
});
