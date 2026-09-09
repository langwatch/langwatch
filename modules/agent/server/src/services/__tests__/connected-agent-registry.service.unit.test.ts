/**
 * Presence reads off the instance registry: who is live now, and who has
 * aged out of the TTL window (ADR-128, "Presence").
 * @see specs/agents/connected-agents.feature
 */
import { PRESENCE_TTL_SECONDS } from "@langwatch/agent-contract";
import { describe, expect, it } from "vitest";
import { SessionStateStoreFactory } from "@langwatch/redis-client";
import { ConnectedAgentRegistryService } from "../connected-agent-registry.service.ts";
import type { InstanceMeta } from "../../services/connected-agent-runtime.service.ts";

function meta(overrides: Partial<InstanceMeta> = {}): InstanceMeta {
  return {
    instanceId: "inst_1",
    projectId: "proj_1",
    hostname: "laptop",
    username: "dev",
    pid: 4242,
    sdk: { name: "langwatch", version: "1.0.0", language: "python" },
    label: null,
    podId: "pod_a",
    connectedAt: Date.now(),
    maxConcurrency: 4,
    ...overrides,
  };
}

describe("ConnectedAgentRegistryService", () => {
  describe("when one instance is connected", () => {
    /** @scenario "An agent is online while one instance is connected" */
    it("lists the instance with its hostname and pid", async () => {
      const store = SessionStateStoreFactory.memory();
      const registry = ConnectedAgentRegistryService.create(store);

      await registry.register({ meta: meta(), agentIds: ["agent_1"] });

      const live = await registry.listLive({ projectId: "proj_1", agentId: "agent_1" });
      expect(live).toEqual([
        expect.objectContaining({ hostname: "laptop", pid: 4242, podId: "pod_a" }),
      ]);
    });
  });

  describe("when the last refresh is older than the presence TTL", () => {
    /** @scenario "An agent goes offline after the presence TTL" */
    it("reads as offline", async () => {
      let now = Date.now();
      const store = SessionStateStoreFactory.memory({ now: () => now });
      const registry = ConnectedAgentRegistryService.create(store);

      await registry.register({ meta: meta(), agentIds: ["agent_1"], now });

      now += (PRESENCE_TTL_SECONDS + 1) * 1000;
      const live = await registry.listLive({ projectId: "proj_1", agentId: "agent_1", now });
      expect(live).toEqual([]);
    });
  });
});
