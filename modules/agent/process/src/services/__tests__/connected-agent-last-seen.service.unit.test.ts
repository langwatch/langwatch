import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import type { AgentService } from "../agent.service.ts";
import { ConnectedAgentLastSeenService } from "../connected-agent-last-seen.service.ts";

describe("ConnectedAgentLastSeenService", () => {
  /** @scenario "The last seen time is written at most once a minute" */
  it("writes at most once per minute for each project and agent", async () => {
    const write = vi.fn(async () => void 0);
    const service = ConnectedAgentLastSeenService.create(
      createApiFixture<AgentService>({ touchLastSeenAt: write }),
    );
    const input = { projectId: "project_one", agentId: "agent_one", now: 1_000 };

    expect(await service.touch(input)).toBe(true);
    expect(await service.touch({ ...input, now: 31_000 })).toBe(false);
    expect(await service.touch({ ...input, now: 62_000 })).toBe(true);
    expect(await service.touch({ ...input, projectId: "project_two" })).toBe(true);
    expect(write).toHaveBeenCalledTimes(3);
  });

  it("retries a failed write on the next heartbeat", async () => {
    const write = vi
      .fn()
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockResolvedValue(void 0);
    const service = ConnectedAgentLastSeenService.create(
      createApiFixture<AgentService>({ touchLastSeenAt: write }),
    );
    const input = { projectId: "project_one", agentId: "agent_one", now: 1_000 };

    expect(await service.touch(input)).toBe(false);
    expect(await service.touch(input)).toBe(true);
    expect(write).toHaveBeenCalledTimes(2);
  });

  /** @scenario "Application instances do not share presence write throttle state" */
  it("does not share throttle state between application instances", async () => {
    const write = vi.fn(async () => void 0);
    const agents = createApiFixture<AgentService>({ touchLastSeenAt: write });
    const first = ConnectedAgentLastSeenService.create(agents);
    const second = ConnectedAgentLastSeenService.create(agents);
    const input = { projectId: "project_one", agentId: "agent_one", now: 1_000 };

    await first.touch(input);
    await second.touch(input);
    expect(write).toHaveBeenCalledTimes(2);
  });
});
