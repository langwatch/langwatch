import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

vi.mock("~/server/app-layer/app", () => ({
  tryGetApp: () => null,
  getApp: vi.fn(),
}));

import { getApp } from "~/server/app-layer/app";
import { ScenarioEventType } from "~/server/scenarios/scenario-event.enums";
import type { ScenarioEvent } from "~/server/scenarios/scenario-event.types";
import { broadcastStreamingEvent, isLiveFrameEvent } from "../app";

let broadcastToTenantRateLimited: Mock;

beforeEach(() => {
  broadcastToTenantRateLimited = vi.fn().mockResolvedValue(undefined);
  (getApp as Mock).mockReturnValue({
    broadcast: { broadcastToTenantRateLimited },
  });
});

describe("isLiveFrameEvent()", () => {
  it("sends a stored message snapshot to viewers at once", () => {
    expect(isLiveFrameEvent(ScenarioEventType.MESSAGE_SNAPSHOT)).toBe(true);
  });

  it("leaves run lifecycle events to the debounced update", () => {
    expect(isLiveFrameEvent(ScenarioEventType.RUN_FINISHED)).toBe(false);
  });
});

describe("broadcastStreamingEvent()", () => {
  describe("when a message snapshot was stored", () => {
    /** @scenario "Storing a message snapshot broadcasts a reset frame" */
    it("broadcasts a structural reset frame for the run", async () => {
      await broadcastStreamingEvent("project_1", {
        type: ScenarioEventType.MESSAGE_SNAPSHOT,
        scenarioRunId: "run_1",
        batchRunId: "batch_1",
        scenarioId: "scenario_1",
        scenarioSetId: "set_1",
        timestamp: 1,
        messages: [{ id: "m0", role: "user", content: "hi" }],
      } as ScenarioEvent);

      expect(broadcastToTenantRateLimited).toHaveBeenCalledWith(
        "project_1",
        JSON.stringify({ e: "R", r: "run_1", b: "batch_1" }),
        "simulation_updated",
        "structural",
      );
    });
  });
});
