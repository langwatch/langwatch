import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import type { LangyLocalWorkspaceChannel } from "../../../../channels/langy-local-workspace.channel.ts";
import type { LangyLocalPresenceRepository } from "../../../../repositories/langy-local-presence.repository.ts";
import { LocalSkipPolicyService } from "../langy-local-skip-policy.service.ts";

type Presence = LangyLocalPresenceRepository;

function setup({ skipping, approver = "user-1" }: { skipping: boolean; approver?: string }) {
  const writePolicy = vi.fn<Presence["writePolicy"]>(async () => {});
  const nudge = vi.fn<LangyLocalWorkspaceChannel["nudge"]>(async () => {});
  const changePolicy = vi.fn(async () => {});
  const skipPolicy = LocalSkipPolicyService.create({
    presence: createApiFixture<Presence>({
      readPolicy: async () => skipping,
      writePolicy,
      getByConversationId: async () =>
        createApiFixture<Awaited<ReturnType<Presence["getByConversationId"]>>>({
          userId: approver,
        }),
    }),
    workspace: createApiFixture<LangyLocalWorkspaceChannel>({ nudge }),
  });
  return { skipPolicy, writePolicy, nudge, changePolicy };
}

describe("reconciling the skip choice against the conversation's model", () => {
  describe("given permission checks are off and the model may skip", () => {
    it("keeps them off and changes nothing", async () => {
      const { skipPolicy, writePolicy, changePolicy } = setup({ skipping: true });

      const skipping = await skipPolicy.reconcile({
        projectId: "project-1",
        conversationId: "conv-1",
        model: "anthropic/claude-fable-5-1",
        skipGate: async () => ({ allowed: true }),
        changePolicy,
      });

      expect(skipping).toBe(true);
      expect(writePolicy).not.toHaveBeenCalled();
      expect(changePolicy).not.toHaveBeenCalled();
    });
  });

  describe("given permission checks are off and the conversation switches to a model that may not skip", () => {
    /** @scenario "Changing the model ends the skip" */
    it("turns the checks back on, tells the terminal and records it against the approver", async () => {
      const { skipPolicy, writePolicy, nudge, changePolicy } = setup({
        skipping: true,
        approver: "approver-1",
      });

      const skipping = await skipPolicy.reconcile({
        projectId: "project-1",
        conversationId: "conv-1",
        model: "openai/gpt-x",
        skipGate: async () => ({ allowed: false }),
        changePolicy,
      });

      expect(skipping).toBe(false);
      expect(writePolicy).toHaveBeenCalledWith({
        conversationId: "conv-1",
        skipPermissions: false,
      });
      expect(nudge).toHaveBeenCalledWith({
        conversationId: "conv-1",
        nudge: { policy: { skipPermissions: false } },
      });
      expect(changePolicy).toHaveBeenCalledWith({
        conversationId: "conv-1",
        userId: "approver-1",
        skipPermissions: false,
        model: "openai/gpt-x",
      });
    });
  });

  describe("given permission checks are already on", () => {
    it("answers false without asking the model gate", async () => {
      const { skipPolicy, writePolicy } = setup({ skipping: false });
      const skipGate = vi.fn(async () => ({ allowed: true }));

      const skipping = await skipPolicy.reconcile({
        projectId: "project-1",
        conversationId: "conv-1",
        model: "openai/gpt-x",
        skipGate,
        changePolicy: async () => {},
      });

      expect(skipping).toBe(false);
      expect(skipGate).not.toHaveBeenCalled();
      expect(writePolicy).not.toHaveBeenCalled();
    });
  });
});
