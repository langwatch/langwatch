import { describe, expect, it } from "vitest";
import { filterScenarioTargetAgents } from "../scenario-target-selector";

describe("filterScenarioTargetAgents", () => {
  it("keeps supported target types, orders newest first, and narrows by name", () => {
    const agents = [
      {
        id: "workflow",
        name: "Nightly workflow",
        type: "workflow",
        updatedAt: "2026-08-24T10:00:00.000Z",
        hasDevTunnel: false,
      },
      {
        id: "prompt",
        name: "Not a scenario target",
        type: "prompt",
        updatedAt: "2026-08-25T10:00:00.000Z",
        hasDevTunnel: false,
      },
      {
        id: "http",
        name: "Checkout HTTP agent",
        type: "http",
        updatedAt: "2026-08-25T12:00:00.000Z",
        hasDevTunnel: true,
      },
    ];

    expect(filterScenarioTargetAgents(agents, "checkout")).toEqual([
      expect.objectContaining({ id: "http", type: "http" }),
    ]);
    expect(filterScenarioTargetAgents(agents, "").map((agent) => agent.id)).toEqual([
      "http",
      "workflow",
    ]);
  });
});
