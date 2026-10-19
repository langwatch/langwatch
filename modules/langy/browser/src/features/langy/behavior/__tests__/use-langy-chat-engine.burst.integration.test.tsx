/**
 * @vitest-environment jsdom
 *
 * The engine against the real AI SDK `useChat` when an answer arrives in a burst, the way it does
 * after the worker's relay reconnects on a flaky link.
 * @see specs/langy/langy-turn-recovery.feature
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import type { UIMessage, UIMessageChunk } from "ai";
import { useEffect, useState } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../../behavior/langy-api.ts", () => ({
  api: {
    useUtils: () => ({
      dashboardWidgets: { list: { invalidate: () => Promise.resolve() } },
      graphs: { getAll: { invalidate: () => Promise.resolve() } },
    }),
  },
}));

vi.mock("@langwatch/browser-host/errors", () => ({
  isHandledByGlobalHandler: () => false,
}));

import { useLangyChatEngine } from "../use-langy-chat-engine.ts";

const BURST = 400;

/** Every piece of the answer queued before the engine reads the first one. */
function burstStream(): ReadableStream<UIMessageChunk> {
  return new ReadableStream<UIMessageChunk>({
    start(controller) {
      controller.enqueue({ type: "start" });
      controller.enqueue({ type: "text-start", id: "t1" });
      for (let piece = 0; piece < BURST; piece++) {
        controller.enqueue({ type: "text-delta", id: "t1", delta: `${piece} ` });
      }
      controller.enqueue({ type: "text-end", id: "t1" });
      controller.enqueue({ type: "finish" });
      controller.close();
    },
  });
}

/** The panel re-derives state from every transcript change, as its effects do. */
function useEngineInAPanel() {
  const engine = useLangyChatEngine({
    transport: { sendMessages: async () => burstStream(), reconnectToStream: async () => null },
  } as never);
  const [, setTranscriptSize] = useState(0);
  useEffect(() => setTranscriptSize(textOf(engine.messages).length), [engine.messages]);
  return engine;
}

function textOf(messages: UIMessage[]): string {
  return messages
    .flatMap((message) => message.parts)
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("");
}

describe("useLangyChatEngine", () => {
  describe("when the whole answer arrives in one burst", () => {
    /** @scenario "A burst of streamed text does not fail the turn" */
    it("shows the whole answer and reports no failure", async () => {
      const { result } = renderHook(() => useEngineInAPanel());

      act(() => void result.current.sendMessage({ text: "Write a long answer" }));

      await waitFor(() => expect(result.current.status).toBe("ready"));
      expect(result.current.error).toBeUndefined();
      const expected = Array.from({ length: BURST }, (_, piece) => `${piece} `).join("");
      expect(textOf(result.current.messages)).toContain(expected);
    });
  });
});
