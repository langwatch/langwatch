/**
 * @vitest-environment node
 * @see modules/scenario/specs/scenario-run-hooks.feature
 */
import { SCENARIO_CONNECTOR_STEPS_FLAG_KEY } from "@langwatch/feature-flag-contract";
import { describe, expect, it, vi } from "vitest";

import { ScenarioConnectorStepsGateService } from "../scenario-connector-steps-gate.service.ts";

function gateFor({ isSaas, flagOn }: { isSaas: boolean; flagOn: boolean }) {
  const isEnabled = vi.fn(async () => flagOn);
  const gate = ScenarioConnectorStepsGateService.create({ isSaas, featureFlags: { isEnabled } });
  return { gate, isEnabled };
}

describe("ScenarioConnectorStepsGateService", () => {
  describe("given the hosted product", () => {
    it("is off for a project the flag does not release", async () => {
      const { gate, isEnabled } = gateFor({ isSaas: true, flagOn: false });

      await expect(gate.isEnabled({ projectId: "project-1" })).resolves.toBe(false);
      expect(isEnabled).toHaveBeenCalledWith(SCENARIO_CONNECTOR_STEPS_FLAG_KEY, {
        kind: "project",
        projectId: "project-1",
      });
    });

    it("is on for a project the flag releases", async () => {
      const { gate } = gateFor({ isSaas: true, flagOn: true });

      await expect(gate.isEnabled({ projectId: "project-1" })).resolves.toBe(true);
    });
  });

  describe("given a self-hosted or local deployment", () => {
    /** @scenario "A self-hosted deployment runs Connector steps without the flag" */
    it("is on without asking the flag", async () => {
      const { gate, isEnabled } = gateFor({ isSaas: false, flagOn: false });

      await expect(gate.isEnabled({ projectId: "project-1" })).resolves.toBe(true);
      expect(isEnabled).not.toHaveBeenCalled();
    });
  });
});
