/**
 * @vitest-environment node
 * @see specs/agents/connected-agents.feature
 */
import type { AgentApi } from "@langwatch/agent-contract";
import type { ConnectedTargetAgent } from "@langwatch/suite-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { createSuiteTestApp } from "./suite.fixture.ts";

const personal: ConnectedTargetAgent = {
  id: "agent_1",
  name: "laptop",
  type: "connected",
  ownerUserId: "u_1",
};

function appWithOwners() {
  return createSuiteTestApp({
    dependencies: {
      agents: createApiFixture<AgentApi>({
        ownersOf: async () => new Map([["u_1", { userId: "u_1", name: "Ana" }]]),
      }),
    },
  });
}

describe("given a run that targets a personal development agent", () => {
  describe("when someone other than its owner starts it", () => {
    /** @scenario "A teammate cannot target another person's personal agent" */
    it("refuses as owner-only, naming the owner", async () => {
      await expect(
        appWithOwners().assertConnectedAgentsRunnable({
          agents: [personal],
          actor: { id: "u_2", label: "user" },
        }),
      ).rejects.toMatchObject({
        code: "agent_owner_only",
        meta: { agentId: "agent_1", agentName: "laptop", ownerUserId: "u_1", ownerName: "Ana" },
      });
    });
  });

  describe("when the run has no actor at all", () => {
    /** @scenario "A legacy project key can never target a personal agent" */
    it("refuses as owner-only", async () => {
      await expect(
        appWithOwners().assertConnectedAgentsRunnable({ agents: [personal], actor: undefined }),
      ).rejects.toMatchObject({ code: "agent_owner_only" });
    });
  });

  describe("when its owner starts it, or the agent is shared", () => {
    /** @scenario "The owner can target their own personal agent" */
    it("admits the run without reading any owner name", async () => {
      const app = createSuiteTestApp();

      await expect(
        app.assertConnectedAgentsRunnable({
          agents: [personal, { ...personal, id: "agent_2", ownerUserId: null }],
          actor: { id: "u_1", label: "user" },
        }),
      ).resolves.toBeUndefined();
    });
  });
});
