import { describe, expect, it, vi } from "vitest";
import {
  createLangyTrustedMessageReader,
  type LangyMessageRepository,
  LangyMessageService,
} from "../langy-message.service";
import type {
  LangyConversationRepository,
  LangyConversationRow,
} from "../repositories/langy-conversation.repository";

function makeMessageRepo(overrides?: Partial<LangyMessageRepository>) {
  return {
    findAllByConversation: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as LangyMessageRepository;
}

function conversationRow(
  overrides: Partial<LangyConversationRow> = {},
): LangyConversationRow {
  return {
    id: "conversation-1",
    userId: "user-1",
    title: null,
    isShared: false,
    status: "idle",
    currentTurnId: null,
    lastError: null,
    messageCount: 0,
    lastActivityAtMs: 1,
    createdAtMs: 1,
    ...overrides,
  };
}

function makeConversationRepo(
  overrides?: Partial<LangyConversationRepository>,
): LangyConversationRepository {
  return {
    findVisibleById: vi.fn().mockResolvedValue(null),
    findOwnership: vi.fn().mockResolvedValue("missing"),
    findAllForUser: vi.fn().mockResolvedValue([]),
    findActiveOwnedIds: vi.fn().mockResolvedValue([]),
    findPendingHandoff: vi.fn().mockResolvedValue(null),
    findRunToken: vi.fn().mockResolvedValue(null),
    turnExists: vi.fn().mockResolvedValue(false),
    ...overrides,
  };
}

describe("LangyMessageService", () => {
  describe.each([
    {
      visibility: "owned",
      conversation: conversationRow(),
    },
    {
      visibility: "shared by another user",
      conversation: conversationRow({ userId: "user-2", isShared: true }),
    },
  ])("when the conversation is $visibility", ({ conversation }) => {
    it("returns messages after checking project, user, and conversation scope", async () => {
      const rows = [
        {
          id: "message-1",
          role: "user" as const,
          parts: [{ type: "text" as const, text: "hello" }],
          createdAt: new Date(),
        },
      ];
      const messages = makeMessageRepo({
        findAllByConversation: vi.fn().mockResolvedValue(rows),
      });
      const conversations = makeConversationRepo({
        findVisibleById: vi.fn().mockResolvedValue(conversation),
      });
      const service = new LangyMessageService(messages, conversations);

      await expect(
        service.getAllByConversation({
          conversationId: "conversation-1",
          projectId: "project-1",
          userId: "user-1",
        }),
      ).resolves.toEqual(rows);

      expect(conversations.findVisibleById).toHaveBeenCalledWith({
        id: "conversation-1",
        projectId: "project-1",
        userId: "user-1",
      });
      expect(messages.findAllByConversation).toHaveBeenCalledWith({
        conversationId: "conversation-1",
        projectId: "project-1",
      });
    });
  });

  describe.each([
    "private conversation owned by another user",
    "missing conversation",
  ])("when the target is a %s", () => {
    it("reports the same not-found result without reading its messages", async () => {
      const messages = makeMessageRepo();
      const conversations = makeConversationRepo({
        // The visibility repository deliberately collapses private and absent.
        findVisibleById: vi.fn().mockResolvedValue(null),
      });
      const service = new LangyMessageService(messages, conversations);

      await expect(
        service.getAllByConversation({
          conversationId: "conversation-1",
          projectId: "project-1",
          userId: "user-1",
        }),
      ).rejects.toMatchObject({
        code: "langy_conversation_not_found",
        meta: { conversationId: "conversation-1" },
      });
      expect(messages.findAllByConversation).not.toHaveBeenCalled();
    });
  });
});

describe("createLangyTrustedMessageReader", () => {
  it("flattens stored rows for title generation without exposing the capability on the user service", async () => {
    const repo = makeMessageRepo({
      findAllByConversation: vi.fn().mockResolvedValue([
        {
          id: "m1",
          role: "user",
          parts: [{ type: "text", text: "hello" }],
          createdAt: new Date(),
        },
        {
          id: "m2",
          role: "assistant",
          parts: [
            { type: "text", text: "line one" },
            { type: "text", text: "line two" },
          ],
          createdAt: new Date(),
        },
      ]),
    });
    const trustedReader = createLangyTrustedMessageReader(repo);

    await expect(
      trustedReader.getRecordsByConversation({
        conversationId: "c1",
        projectId: "p1",
      }),
    ).resolves.toEqual([
      { id: "m1", role: "user", content: "hello" },
      { id: "m2", role: "assistant", content: "line one\nline two" },
    ]);
  });

  it("yields empty content for non-text parts", async () => {
    const repo = makeMessageRepo({
      findAllByConversation: vi.fn().mockResolvedValue([
        {
          id: "m1",
          role: "assistant",
          parts: [{ type: "tool-call" }],
          createdAt: new Date(),
        },
      ]),
    });

    await expect(
      createLangyTrustedMessageReader(repo).getRecordsByConversation({
        conversationId: "c1",
        projectId: "p1",
      }),
    ).resolves.toEqual([{ id: "m1", role: "assistant", content: "" }]);
  });
});
