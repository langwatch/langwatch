/**
 * Who may reach a conversation's shared folder.
 *
 * @see specs/langy/langy-local-permissions.feature
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { conversations } = vi.hoisted(() => ({
  conversations: { findByIdVisible: vi.fn() },
}));

vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({ langy: { conversations } }),
}));

import { LangyConversationNotFoundError } from "~/server/app-layer/langy/errors";
import {
  requireOwnConversation,
  requireVisibleConversation,
} from "../own-conversation";

const scope = {
  projectId: "project_1",
  conversationId: "conv_1",
  userId: "user_riley",
};

const row = (isOwn: boolean) => ({
  id: "conv_1",
  title: "Instrument tracing",
  isOwn,
});

describe("given a conversation with a shared folder", () => {
  beforeEach(() => {
    conversations.findByIdVisible.mockReset();
  });

  describe("when its owner acts on the folder", () => {
    it("hands back the conversation, read with the caller's own scope", async () => {
      conversations.findByIdVisible.mockResolvedValue(row(true));

      await expect(requireOwnConversation(scope)).resolves.toMatchObject({
        id: "conv_1",
      });
      expect(conversations.findByIdVisible).toHaveBeenCalledWith({
        id: "conv_1",
        projectId: "project_1",
        userId: "user_riley",
      });
    });
  });

  describe("when a teammate the conversation is shared with acts on the folder", () => {
    /** @scenario "A key never reaches the folder of a teammate's shared conversation" */
    it("answers not found, the same as for a conversation that does not exist", async () => {
      conversations.findByIdVisible.mockResolvedValue(row(false));
      const shared = await requireOwnConversation(scope).catch((e) => e);

      conversations.findByIdVisible.mockResolvedValue(null);
      const missing = await requireOwnConversation(scope).catch((e) => e);

      expect(shared).toBeInstanceOf(LangyConversationNotFoundError);
      expect(missing).toBeInstanceOf(LangyConversationNotFoundError);
      expect((shared as Error).message).toBe((missing as Error).message);
    });
  });

  describe("when a teammate only reads it", () => {
    it("hands back the shared conversation", async () => {
      conversations.findByIdVisible.mockResolvedValue(row(false));

      await expect(requireVisibleConversation(scope)).resolves.toMatchObject({
        isOwn: false,
      });
    });

    it("answers not found for a conversation the reader cannot see", async () => {
      conversations.findByIdVisible.mockResolvedValue(null);

      await expect(requireVisibleConversation(scope)).rejects.toBeInstanceOf(
        LangyConversationNotFoundError,
      );
    });
  });
});
