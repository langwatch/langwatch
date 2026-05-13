/**
 * Unit tests for `buildLangyAssistantOnFinish` — the persistence callback
 * shared between the legacy AI-SDK `streamText` path and the Mastra agent
 * path (PR-4.4 part a). Pins the post-stream behaviour both paths now share:
 * extract assistant + tool message parts, persist via LangyMessageService,
 * touch the conversation, and swallow persistence errors.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAppendMessage = vi.fn();
const mockTouchConversation = vi.fn();
const mockGetProjectMemory = vi.fn();
const mockGetUserPrefs = vi.fn();
const mockEnsureConversation = vi.fn();

vi.mock("~/server/db", () => ({ prisma: {} }));

vi.mock("~/server/app-layer/clients/tokenizer/tiktoken.client", () => ({
  TiktokenClient: class {
    async countTokens(): Promise<number> {
      return 7;
    }
  },
}));

vi.mock("~/server/services/langy", () => ({
  LangyConversationService: {
    create: () => ({
      ensureConversation: (...args: unknown[]) =>
        mockEnsureConversation(...args),
      touch: (...args: unknown[]) => mockTouchConversation(...args),
    }),
  },
  LangyMessageService: {
    create: () => ({
      append: (...args: unknown[]) => mockAppendMessage(...args),
    }),
  },
  LangyProjectMemoryService: {
    create: () => ({
      getById: (...args: unknown[]) => mockGetProjectMemory(...args),
    }),
  },
  LangyUserPreferencesService: {
    create: () => ({
      getById: (...args: unknown[]) => mockGetUserPrefs(...args),
    }),
  },
}));

const { buildLangyAssistantOnFinish } = await import("../langy");

const ctx = {
  conversationId: "conv_abc",
  projectId: "proj_demo",
  model: "openai/gpt-5-mini",
};

describe("buildLangyAssistantOnFinish — persists assistant turn at stream end", () => {
  beforeEach(() => {
    mockAppendMessage.mockReset();
    mockTouchConversation.mockReset();
    mockAppendMessage.mockResolvedValue(undefined);
    mockTouchConversation.mockResolvedValue(undefined);
  });

  describe("given a stream that produced a single string-content assistant message", () => {
    it("appends one assistant message with a synthesised text part and touches the conversation", async () => {
      const onFinish = buildLangyAssistantOnFinish(ctx);

      await onFinish({
        text: "hello world",
        response: {
          messages: [{ role: "assistant", content: "hello world" }],
        },
      });

      expect(mockAppendMessage).toHaveBeenCalledTimes(1);
      const appendArgs = mockAppendMessage.mock.calls[0]![0] as {
        conversationId: string;
        projectId: string;
        role: string;
        parts: Array<Record<string, unknown>>;
        tokenCount: number | null;
      };
      expect(appendArgs.conversationId).toBe("conv_abc");
      expect(appendArgs.projectId).toBe("proj_demo");
      expect(appendArgs.role).toBe("assistant");
      expect(appendArgs.parts).toEqual([
        { type: "text", text: "hello world", role: "assistant" },
      ]);
      expect(appendArgs.tokenCount).toBe(7);

      expect(mockTouchConversation).toHaveBeenCalledTimes(1);
      expect(mockTouchConversation).toHaveBeenCalledWith({
        id: "conv_abc",
        projectId: "proj_demo",
      });
    });
  });

  describe("given a stream that interleaved assistant text + tool calls", () => {
    it("preserves the tool-call parts alongside assistant text in append order", async () => {
      const onFinish = buildLangyAssistantOnFinish(ctx);

      await onFinish({
        text: "looked up datasets",
        response: {
          messages: [
            {
              role: "assistant",
              content: [
                { type: "text", text: "let me check" },
                {
                  type: "tool-call",
                  toolCallId: "tc_1",
                  toolName: "list_datasets",
                  input: {},
                },
              ],
            },
            {
              role: "tool",
              content: [
                {
                  type: "tool-result",
                  toolCallId: "tc_1",
                  toolName: "list_datasets",
                  output: { items: [] },
                },
              ],
            },
          ],
        },
      });

      const parts = mockAppendMessage.mock.calls[0]![0].parts as Array<
        Record<string, unknown>
      >;
      expect(parts).toHaveLength(3);
      expect(parts[0]).toMatchObject({ type: "text", role: "assistant" });
      expect(parts[1]).toMatchObject({ type: "tool-call", role: "assistant" });
      expect(parts[2]).toMatchObject({ type: "tool-result", role: "tool" });
    });
  });

  describe("given a stream with no assistant or tool messages", () => {
    it("still appends an empty parts array (so the turn boundary is recorded)", async () => {
      const onFinish = buildLangyAssistantOnFinish(ctx);

      await onFinish({
        text: "",
        response: { messages: [{ role: "user", content: "hi" }] },
      });

      expect(mockAppendMessage).toHaveBeenCalledTimes(1);
      expect(mockAppendMessage.mock.calls[0]![0].parts).toEqual([]);
    });
  });

  describe("given the message-append service rejects", () => {
    it("swallows the error and never calls touch — a 500 to the user after stream completion would be worse than a missed turn record", async () => {
      mockAppendMessage.mockRejectedValueOnce(new Error("db down"));

      const onFinish = buildLangyAssistantOnFinish(ctx);

      await expect(
        onFinish({
          text: "x",
          response: { messages: [{ role: "assistant", content: "x" }] },
        }),
      ).resolves.toBeUndefined();

      expect(mockAppendMessage).toHaveBeenCalledTimes(1);
      expect(mockTouchConversation).not.toHaveBeenCalled();
    });
  });

  describe("given args.response.messages is undefined", () => {
    it("treats it as an empty list and still records the turn", async () => {
      const onFinish = buildLangyAssistantOnFinish(ctx);

      await onFinish({ text: "", response: {} });

      expect(mockAppendMessage).toHaveBeenCalledTimes(1);
      expect(mockAppendMessage.mock.calls[0]![0].parts).toEqual([]);
    });
  });
});
