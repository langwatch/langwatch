/**
 * @vitest-environment jsdom
 *
 * The engine's retry against the real AI SDK `useChat`: what the failed turn
 * already did stays on screen while the turn is re-driven.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import type { UIMessage, UIMessageChunk } from "ai";
import { describe, expect, it, vi } from "vitest";

vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({
      dashboardWidgets: { list: { invalidate: () => Promise.resolve() } },
      graphs: { getAll: { invalidate: () => Promise.resolve() } },
    }),
  },
}));

vi.mock("~/utils/trpcError", () => ({
  isHandledByGlobalHandler: () => false,
}));

import type { LangyMessageDto } from "../../data/langy.dtos";
import { useLangyChatEngine } from "../useLangyChatEngine";

function answerStream(text: string): ReadableStream<UIMessageChunk> {
  return new ReadableStream<UIMessageChunk>({
    start(controller) {
      controller.enqueue({ type: "start" });
      controller.enqueue({ type: "text-start", id: "t1" });
      controller.enqueue({ type: "text-delta", id: "t1", delta: text });
      controller.enqueue({ type: "text-end", id: "t1" });
      controller.enqueue({ type: "finish" });
      controller.close();
    },
  });
}

const plan = {
  type: "tool-todowrite",
  toolCallId: "call_plan",
  state: "output-available",
  input: {
    todos: [
      { content: "Read the agent", status: "completed" },
      { content: "Wire tracing in", status: "in_progress" },
    ],
  },
  output: "",
};

const history = [
  {
    id: "user-1",
    role: "user",
    parts: [{ type: "text", text: "Local folder connected" }],
  },
  { id: "failed-reply", role: "assistant", parts: [plan] },
] as unknown as LangyMessageDto[];

describe("useLangyChatEngine retryTurn", () => {
  describe("when a turn that wrote a plan failed and the user tries again", () => {
    /** @scenario "Trying again keeps the plan the failed turn wrote" */
    it("keeps the failed reply, plan included, and adds the retried answer below it", async () => {
      const sendMessages = vi.fn(
        async (_options: { trigger: string; messages: UIMessage[] }) =>
          answerStream("Done."),
      );
      const transport = {
        sendMessages,
        reconnectToStream: async () => null,
      };

      const { result } = renderHook(() =>
        useLangyChatEngine({ transport: transport as never }),
      );
      act(() => result.current.applyHistoryToEngine(history));

      act(() => result.current.retryTurn());

      await waitFor(() => expect(result.current.status).toBe("ready"));

      expect(sendMessages).toHaveBeenCalledTimes(1);
      expect(sendMessages.mock.calls[0]?.[0].trigger).toBe(
        "regenerate-message",
      );
      const messages = result.current.messages;
      expect(messages.map((m) => m.role)).toEqual([
        "user",
        "assistant",
        "assistant",
      ]);
      expect(messages[1]?.id).toBe("failed-reply");
      expect(messages[1]?.parts).toEqual([plan]);
      expect(messages[2]?.parts).toContainEqual(
        expect.objectContaining({ type: "text", text: "Done." }),
      );
    });
  });

  describe("when the failed turn left nothing on screen", () => {
    it("re-drives the turn without an empty reply above the new answer", async () => {
      const transport = {
        sendMessages: async () => answerStream("Done."),
        reconnectToStream: async () => null,
      };
      const { result } = renderHook(() =>
        useLangyChatEngine({ transport: transport as never }),
      );
      act(() =>
        result.current.applyHistoryToEngine([
          history[0]!,
          { id: "empty", role: "assistant", parts: [] },
        ] as unknown as LangyMessageDto[]),
      );

      act(() => result.current.retryTurn());

      await waitFor(() => expect(result.current.status).toBe("ready"));
      expect(result.current.messages.map((m) => m.id)).not.toContain("empty");
      expect(result.current.messages.map((m) => m.role)).toEqual([
        "user",
        "assistant",
      ]);
    });
  });
});
