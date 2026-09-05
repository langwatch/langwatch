/**
 * The `lastSeenAt` write throttle: at most once a minute per agent, so a
 * busy instance never turns presence into a write storm (ADR-128).
 * @see specs/agents/connected-agents.feature
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ConnectedAgentPresenceProjection,
  type AgentLastSeenWriter,
} from "../connected-agent-presence.projection";

function repository(): AgentLastSeenWriter & { touchLastSeenAt: ReturnType<typeof vi.fn> } {
  return { touchLastSeenAt: vi.fn().mockResolvedValue(undefined) };
}

beforeEach(() => {
  ConnectedAgentPresenceProjection.resetLastSeenThrottle();
});

describe("ConnectedAgentPresenceProjection.touchAgentLastSeen", () => {
  describe("when presence is refreshed twice inside a minute", () => {
    /** @scenario "The last seen time is written at most once a minute" */
    it("writes the row once, and again after the minute", async () => {
      const writer = repository();
      const base = Date.now();

      const first = await ConnectedAgentPresenceProjection.touchAgentLastSeen({
        repository: writer,
        projectId: "proj_1",
        agentId: "agent_1",
        now: base,
      });
      const second = await ConnectedAgentPresenceProjection.touchAgentLastSeen({
        repository: writer,
        projectId: "proj_1",
        agentId: "agent_1",
        now: base + 30_000,
      });
      const third = await ConnectedAgentPresenceProjection.touchAgentLastSeen({
        repository: writer,
        projectId: "proj_1",
        agentId: "agent_1",
        now: base + 61_000,
      });

      expect(first).toBe(true);
      expect(second).toBe(false);
      expect(third).toBe(true);
      expect(writer.touchLastSeenAt).toHaveBeenCalledTimes(2);
    });
  });
});
