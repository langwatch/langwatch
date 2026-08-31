/**
 * What the agents page reads off a connected agent, without drawing it.
 *
 * @see specs/features/agents/connected-agents-ui.feature
 */

import { describe, expect, it } from "vitest";
import {
  type ConnectedAgentView,
  environmentTone,
  instanceCountLabel,
  presenceLabel,
  sortConnectedAgents,
} from "../connected-agent-rows";

function agent(
  overrides: Partial<ConnectedAgentView> = {},
): ConnectedAgentView {
  return {
    id: "agent_1",
    name: "support-agent",
    environment: "production",
    hostLabel: null,
    lastSeenAt: null,
    status: "online",
    instances: [],
    owner: null,
    parameters: [],
    config: {},
    ...overrides,
  };
}

describe("environmentTone", () => {
  describe("given the environments a card can carry", () => {
    /** @scenario "The environment reads in a colour of its own" */
    it("gives production and development a colour of their own and the rest the neutral one", () => {
      expect(environmentTone("production")).not.toEqual(
        environmentTone("development"),
      );
      expect(environmentTone("staging")).toEqual(environmentTone("qa"));
      expect(environmentTone("staging")).not.toEqual(
        environmentTone("production"),
      );
      expect(environmentTone("staging")).not.toEqual(
        environmentTone("development"),
      );
      expect(environmentTone(null)).toEqual(environmentTone("staging"));
    });
  });
});

describe("presenceLabel", () => {
  describe("given processes hold the agent", () => {
    /** @scenario "An online agent reads how many instances hold it" */
    it("counts the instances", () => {
      expect(
        presenceLabel({
          status: "online",
          instanceCount: 3,
          lastSeenAt: null,
        }),
      ).toBe("Online · 3 instances");
    });

    /** @scenario "An agent with one instance reads it in the singular" */
    it("reads one instance in the singular", () => {
      expect(
        presenceLabel({
          status: "online",
          instanceCount: 1,
          lastSeenAt: null,
        }),
      ).toBe("Online · 1 instance");
    });
  });

  describe("given no process holds the agent", () => {
    /** @scenario "An offline agent reads when it was last seen" */
    it("reads when it was last seen", () => {
      const now = new Date("2026-08-30T12:00:00Z");
      expect(
        presenceLabel({
          status: "offline",
          instanceCount: 0,
          lastSeenAt: new Date("2026-08-30T10:00:00Z"),
          now,
        }),
      ).toBe("Offline · last seen 2 hours ago");
    });
  });
});

describe("instanceCountLabel", () => {
  describe("given the agent is online", () => {
    it("counts the instances that hold it", () => {
      expect(instanceCountLabel(agent({ instances: [] }))).toBe("1 instance");
    });
  });

  describe("given the agent is offline", () => {
    it("counts nothing", () => {
      expect(instanceCountLabel(agent({ status: "offline" }))).toBeNull();
    });
  });
});

describe("sortConnectedAgents", () => {
  describe("given one name in several environments", () => {
    /** @scenario "Every connected agent is a card of the agents page" */
    it("keeps the names in the order they arrived and puts an online card first", () => {
      const sorted = sortConnectedAgents([
        agent({ id: "a", name: "support-agent", status: "offline" }),
        agent({ id: "b", name: "billing-agent" }),
        agent({
          id: "c",
          name: "support-agent",
          environment: "development",
          status: "online",
        }),
      ]);

      expect(sorted.map((row) => row.id)).toEqual(["c", "a", "b"]);
    });
  });
});
