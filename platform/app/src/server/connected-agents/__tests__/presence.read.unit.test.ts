/**
 * What the agents list reads about presence, including what it shows when the
 * registry cannot answer for one agent.
 *
 * @see specs/agents/connected-agents.feature
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveInstance } from "../instance.registry";
import { NO_PRESENCE, readAgentPresence } from "../presence.read";
import { getConnectedAgentRuntime } from "../runtime";

vi.mock("../runtime", () => ({ getConnectedAgentRuntime: vi.fn() }));

const listLive = vi.fn();

function instance(instanceId: string): LiveInstance {
  return {
    instanceId,
    projectId: "proj_1",
    hostname: `${instanceId}-host`,
    username: "dev",
    pid: 1,
    sdk: { name: "langwatch", version: "1.0.0", language: "python" },
    label: null,
    podId: "pod_a",
    connectedAt: Date.now(),
    maxConcurrency: 4,
    inflight: 0,
    lastSeenAt: Date.now(),
  };
}

beforeEach(() => {
  listLive.mockReset();
  vi.mocked(getConnectedAgentRuntime).mockReturnValue({
    registry: { listLive },
  } as unknown as ReturnType<typeof getConnectedAgentRuntime>);
});

describe("readAgentPresence", () => {
  describe("when the registry answers for every agent", () => {
    it("reports each connected agent as online or offline", async () => {
      listLive.mockImplementation(async ({ agentId }: { agentId: string }) =>
        agentId === "agent_1" ? [instance("inst_1")] : [],
      );

      const presence = await readAgentPresence({
        projectId: "proj_1",
        agents: [
          { id: "agent_1", type: "connected" },
          { id: "agent_2", type: "connected" },
          { id: "agent_3", type: "workflow" },
        ],
      });

      expect(presence.get("agent_1")?.status).toBe("online");
      expect(presence.get("agent_2")?.status).toBe("offline");
      expect(presence.get("agent_3")).toEqual(NO_PRESENCE);
    });
  });

  describe("when the registry fails for one agent", () => {
    it("shows that agent as offline and keeps the rest of the list", async () => {
      listLive.mockImplementation(async ({ agentId }: { agentId: string }) => {
        if (agentId === "agent_1") throw new Error("redis is unreachable");
        return [instance("inst_2")];
      });

      const presence = await readAgentPresence({
        projectId: "proj_1",
        agents: [
          { id: "agent_1", type: "connected" },
          { id: "agent_2", type: "connected" },
        ],
      });

      expect(presence.get("agent_1")).toEqual(NO_PRESENCE);
      expect(presence.get("agent_2")?.status).toBe("online");
    });
  });
});
