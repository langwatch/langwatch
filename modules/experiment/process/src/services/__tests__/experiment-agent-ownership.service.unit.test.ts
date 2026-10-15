import { AgentOwnerOnlyError } from "@langwatch/agent-contract";
import type { AgentApi } from "@langwatch/agent-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import {
  ExperimentAgentOwnershipService,
  type RunTargetAgent,
} from "../experiment-agent-ownership.service.ts";

const personal: RunTargetAgent = {
  id: "agent_1",
  name: "Laptop agent",
  type: "connected",
  ownerUserId: "user_owner",
};

function ownership() {
  const ownersOf = vi.fn<AgentApi["ownersOf"]>(
    async () => new Map([["user_owner", { userId: "user_owner", name: "Owner" }]]),
  );
  const service = ExperimentAgentOwnershipService.create(createApiFixture<AgentApi>({ ownersOf }));
  return { service, ownersOf };
}

describe("ExperimentAgentOwnershipService", () => {
  describe("given someone else's personal development agent", () => {
    it("refuses as agent_owner_only, naming the owner", async () => {
      const { service } = ownership();

      const refusal = await service
        .assertConnectedAgentsRunnable({
          agents: [personal],
          actor: { id: "user_other", label: "user" },
        })
        .catch((error: unknown) => error);

      expect(refusal).toBeInstanceOf(AgentOwnerOnlyError);
      expect(refusal).toMatchObject({ code: "agent_owner_only" });
      expect(JSON.stringify(refusal)).toContain("Owner");
    });
  });

  describe("given the owner's own personal agent", () => {
    it("lets the run start without reading owner names", async () => {
      const { service, ownersOf } = ownership();

      await service.assertConnectedAgentsRunnable({
        agents: [personal],
        actor: { id: "user_owner", label: "user" },
      });

      expect(ownersOf).not.toHaveBeenCalled();
    });
  });

  describe("given a shared agent or an agent that is not connected", () => {
    it("lets anyone run it", async () => {
      const { service } = ownership();

      await expect(
        service.assertConnectedAgentsRunnable({
          agents: [
            { ...personal, ownerUserId: null },
            { ...personal, type: "code" },
          ],
          actor: undefined,
        }),
      ).resolves.toBeUndefined();
    });
  });
});
