import { createApiFixture } from "@langwatch/api-fixture";
import { describe, expect, it, vi } from "vitest";

import type { LocalControlRuntime } from "../../app/langy.members.ts";
import { workspaceChannel } from "../langy-local-control-keys.rules.ts";
import { reconcileSkipPolicy } from "../langy-local-skip-policy.rules.ts";

type Presence = LocalControlRuntime["presence"];

function setup({ skipping, approver = "user-1" }: { skipping: boolean; approver?: string }) {
  const writePolicy = vi.fn<Presence["writePolicy"]>(async () => {});
  const publish = vi.fn<LocalControlRuntime["store"]["publish"]>(async () => 0);
  const changePolicy = vi.fn(async () => {});
  const runtime = createApiFixture<LocalControlRuntime>({
    presence: createApiFixture<Presence>({
      readPolicy: async () => skipping,
      writePolicy,
      getByConversationId: async () =>
        createApiFixture<Awaited<ReturnType<Presence["getByConversationId"]>>>({
          userId: approver,
        }),
    }),
    store: createApiFixture<LocalControlRuntime["store"]>({ publish }),
  });
  return { runtime, writePolicy, publish, changePolicy };
}

describe("reconciling the skip choice against the conversation's model", () => {
  describe("given permission checks are off and the model may skip", () => {
    it("keeps them off and changes nothing", async () => {
      const { runtime, writePolicy, changePolicy } = setup({ skipping: true });

      const skipping = await reconcileSkipPolicy({
        runtime,
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
      const { runtime, writePolicy, publish, changePolicy } = setup({
        skipping: true,
        approver: "approver-1",
      });

      const skipping = await reconcileSkipPolicy({
        runtime,
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
      expect(publish).toHaveBeenCalledWith(
        workspaceChannel("conv-1"),
        JSON.stringify({ policy: { skipPermissions: false } }),
      );
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
      const { runtime, writePolicy } = setup({ skipping: false });
      const skipGate = vi.fn(async () => ({ allowed: true }));

      const skipping = await reconcileSkipPolicy({
        runtime,
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
