/**
 * PR-4.4b: pins the LangyMastraMemory adapter contract.
 *
 * Validates the Mastra ↔ Langy data shape conversion both ways
 * (saveMessages → LangyMessageService.appendMany; recall →
 * LangyMessageService.getAllByConversation), the multitenancy boundary
 * (projectId is bound at construction; cross-tenant resourceId is
 * rejected), and that out-of-scope abstract methods throw the
 * documented error rather than silently no-op.
 */
import { describe, expect, it, vi } from "vitest";
import {
  LangyMastraMemory,
  LangyMastraMemoryUnsupportedError,
} from "../langy-mastra-memory";
import type {
  LangyConversationService,
} from "../LangyConversationService";
import type { LangyMessageService } from "../LangyMessageService";

function buildMemory(overrides?: {
  messageService?: Partial<LangyMessageService>;
  conversationService?: Partial<LangyConversationService>;
  projectId?: string;
  userId?: string;
}) {
  const messageService = {
    getAllByConversation: vi.fn().mockResolvedValue([]),
    append: vi.fn().mockResolvedValue(undefined),
    appendMany: vi.fn().mockResolvedValue({ count: 0 }),
    ...overrides?.messageService,
  } as unknown as LangyMessageService;
  const conversationService = {
    getById: vi.fn().mockResolvedValue(null),
    getAll: vi.fn().mockResolvedValue([]),
    touch: vi.fn().mockResolvedValue(undefined),
    ...overrides?.conversationService,
  } as unknown as LangyConversationService;
  const memory = new LangyMastraMemory({
    messageService,
    conversationService,
    projectId: overrides?.projectId ?? "proj_demo",
    userId: overrides?.userId ?? "user_42",
  });
  return { memory, messageService, conversationService };
}

describe("LangyMastraMemory", () => {
  describe("saveMessages", () => {
    describe("given a single assistant message scoped to the bound project", () => {
      it("persists via LangyMessageService.appendMany with role + projectId mapped", async () => {
        const { memory, messageService, conversationService } = buildMemory();

        await memory.saveMessages({
          messages: [
            {
              id: "m1",
              role: "assistant",
              threadId: "conv_abc",
              resourceId: "proj_demo",
              createdAt: new Date(),
              content: { format: 2, parts: [{ type: "text", text: "hi" }] },
            },
          ],
        });

        expect(messageService.appendMany).toHaveBeenCalledWith([
          expect.objectContaining({
            conversationId: "conv_abc",
            projectId: "proj_demo",
            role: "assistant",
          }),
        ]);
        // Round-trip the JSONB blob through `parts`.
        const firstCallArg = (
          messageService.appendMany as ReturnType<typeof vi.fn>
        ).mock.calls[0]![0] as Array<{ parts: { format: number } }>;
        expect(firstCallArg[0]!.parts.format).toBe(2);
        // Sidebar ordering depends on the conversation's updatedAt — assert touch.
        expect(conversationService.touch).toHaveBeenCalledWith({
          id: "conv_abc",
          projectId: "proj_demo",
        });
      });
    });

    describe("given a message scoped to a DIFFERENT project (cross-tenant leak attempt)", () => {
      it("drops it silently rather than writing to the wrong project", async () => {
        const { memory, messageService } = buildMemory({ projectId: "proj_a" });

        await memory.saveMessages({
          messages: [
            {
              id: "m1",
              role: "assistant",
              threadId: "conv_abc",
              resourceId: "proj_b", // attempted cross-tenant write
              createdAt: new Date(),
              content: { format: 2, parts: [] },
            },
          ],
        });

        expect(messageService.appendMany).not.toHaveBeenCalled();
      });
    });

    describe("given an empty messages array", () => {
      it("makes no write calls", async () => {
        const { memory, messageService } = buildMemory();
        await memory.saveMessages({ messages: [] });
        expect(messageService.appendMany).not.toHaveBeenCalled();
      });
    });
  });

  describe("recall", () => {
    describe("given a thread with two stored Mastra-shaped rows", () => {
      it("maps each row back to MastraDBMessage with format=2 content", async () => {
        const { memory } = buildMemory({
          messageService: {
            getAllByConversation: vi.fn().mockResolvedValue([
              {
                id: "row1",
                conversationId: "conv_abc",
                projectId: "proj_demo",
                role: "user",
                parts: { format: 2, parts: [{ type: "text", text: "hi" }] },
                createdAt: new Date("2026-05-13"),
              },
              {
                id: "row2",
                conversationId: "conv_abc",
                projectId: "proj_demo",
                role: "assistant",
                parts: { format: 2, parts: [{ type: "text", text: "hello" }] },
                createdAt: new Date("2026-05-13"),
              },
            ]),
          } as Partial<LangyMessageService>,
        });

        const result = await memory.recall({ threadId: "conv_abc" });
        expect(result.messages).toHaveLength(2);
        expect(result.messages[0]!.role).toBe("user");
        expect(result.messages[0]!.content.format).toBe(2);
        expect(result.messages[1]!.role).toBe("assistant");
      });
    });

    describe("given a legacy row whose `parts` is a flat array (PR-4.4a shape)", () => {
      it("wraps the array as MastraMessageContentV2 instead of crashing", async () => {
        const { memory } = buildMemory({
          messageService: {
            getAllByConversation: vi.fn().mockResolvedValue([
              {
                id: "row_legacy",
                conversationId: "conv_abc",
                projectId: "proj_demo",
                role: "assistant",
                parts: [{ type: "text", text: "legacy", role: "assistant" }],
                createdAt: new Date("2026-05-13"),
              },
            ]),
          } as Partial<LangyMessageService>,
        });

        const result = await memory.recall({ threadId: "conv_abc" });
        expect(result.messages).toHaveLength(1);
        expect(result.messages[0]!.content.format).toBe(2);
        expect(result.messages[0]!.content.parts).toEqual([
          { type: "text", text: "legacy", role: "assistant" },
        ]);
      });
    });

    describe("given a legacy row stored with role='tool' (top-level tool message)", () => {
      it("folds the role onto 'assistant' since Mastra V2 has no top-level tool role", async () => {
        const { memory } = buildMemory({
          messageService: {
            getAllByConversation: vi.fn().mockResolvedValue([
              {
                id: "row_tool",
                conversationId: "conv_abc",
                projectId: "proj_demo",
                role: "tool",
                parts: { format: 2, parts: [] },
                createdAt: new Date("2026-05-13"),
              },
            ]),
          } as Partial<LangyMessageService>,
        });

        const result = await memory.recall({ threadId: "conv_abc" });
        expect(result.messages[0]!.role).toBe("assistant");
      });
    });

    describe("given no threadId", () => {
      it("returns an empty page rather than reading every thread for the project", async () => {
        const { memory, messageService } = buildMemory();
        // @ts-expect-error — exercising the runtime fallback explicitly
        const result = await memory.recall({});
        expect(result.messages).toEqual([]);
        expect(result.total).toBe(0);
        expect(messageService.getAllByConversation).not.toHaveBeenCalled();
      });
    });
  });

  describe("getThreadById", () => {
    describe("given a conversation owned by the bound user in the bound project", () => {
      it("returns it as a StorageThreadType with resourceId = projectId", async () => {
        const { memory } = buildMemory({
          conversationService: {
            getById: vi.fn().mockResolvedValue({
              id: "conv_abc",
              title: "demo chat",
              projectId: "proj_demo",
              userId: "user_42",
              createdAt: new Date("2026-05-12"),
              updatedAt: new Date("2026-05-13"),
            }),
          } as Partial<LangyConversationService>,
        });
        const thread = await memory.getThreadById({ threadId: "conv_abc" });
        expect(thread).not.toBeNull();
        expect(thread!.id).toBe("conv_abc");
        expect(thread!.resourceId).toBe("proj_demo");
        expect(thread!.title).toBe("demo chat");
      });
    });

    describe("given the conversation does not exist", () => {
      it("returns null rather than fabricating a thread", async () => {
        const { memory } = buildMemory({
          conversationService: {
            getById: vi.fn().mockResolvedValue(null),
          } as Partial<LangyConversationService>,
        });
        expect(await memory.getThreadById({ threadId: "missing" })).toBeNull();
      });
    });
  });

  describe("listThreads", () => {
    describe("given a filter targeting a DIFFERENT projectId than the adapter is bound to", () => {
      it("returns an empty list rather than leaking cross-tenant", async () => {
        const { memory, conversationService } = buildMemory({
          projectId: "proj_a",
        });
        const result = await memory.listThreads({
          filter: { resourceId: "proj_b" },
        });
        expect(result.threads).toEqual([]);
        expect(conversationService.getAll).not.toHaveBeenCalled();
      });
    });
  });

  describe("unsupported abstract methods (PR-4.5+ scope)", () => {
    it("deleteThread throws LangyMastraMemoryUnsupportedError", async () => {
      const { memory } = buildMemory();
      await expect(memory.deleteThread("conv_abc")).rejects.toBeInstanceOf(
        LangyMastraMemoryUnsupportedError,
      );
    });

    it("deleteMessages throws LangyMastraMemoryUnsupportedError", async () => {
      const { memory } = buildMemory();
      await expect(memory.deleteMessages(["m1"])).rejects.toBeInstanceOf(
        LangyMastraMemoryUnsupportedError,
      );
    });

    it("updateWorkingMemory throws LangyMastraMemoryUnsupportedError", async () => {
      const { memory } = buildMemory();
      await expect(
        memory.updateWorkingMemory({
          threadId: "conv_abc",
          workingMemory: "x",
        }),
      ).rejects.toBeInstanceOf(LangyMastraMemoryUnsupportedError);
    });

    it("getWorkingMemory returns null (read is harmless; agent treats null as 'no working memory')", async () => {
      const { memory } = buildMemory();
      expect(
        await memory.getWorkingMemory({ threadId: "conv_abc" }),
      ).toBeNull();
    });
  });
});
