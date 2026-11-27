/**
 * @see modules/scenario/specs/scenario-run-hooks.feature
 */
import { describe, expect, it } from "vitest";

import {
  scenarioAgentsOf,
  suiteTargetOf,
} from "../behavior/scenarios/use-filtered-scenario-targets.ts";

describe("scenarioAgentsOf", () => {
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

    expect(scenarioAgentsOf({ agents, searchValue: "checkout" })).toEqual([
      expect.objectContaining({ id: "http", type: "http" }),
    ]);
    expect(scenarioAgentsOf({ agents, searchValue: "" }).map((agent) => agent.id)).toEqual([
      "http",
      "workflow",
    ]);
  });
});

describe("suiteTargetOf", () => {
  /** @scenario "A run plan never opens on a connector remembered from a scenario run" */
  it("drops a remembered connector pick, so the run dialog opens with no agent chosen", () => {
    expect(suiteTargetOf({ type: "connector", id: "agent_connector" })).toBeNull();
  });

  it("keeps any other pick", () => {
    expect(suiteTargetOf({ type: "http", id: "agent_http" })).toEqual({
      type: "http",
      id: "agent_http",
    });
    expect(suiteTargetOf(null)).toBeNull();
  });
});
