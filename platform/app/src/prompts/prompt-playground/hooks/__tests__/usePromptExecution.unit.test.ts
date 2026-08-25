/**
 * @vitest-environment jsdom
 *
 * Spec: specs/prompts/playground-conversation.feature
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PromptConfigFormValues } from "~/prompts/types";
import { usePromptExecution } from "../usePromptExecution";

const { fetchSSEMock } = vi.hoisted(() => ({ fetchSSEMock: vi.fn() }));

vi.mock("~/utils/sse/fetchSSE", () => ({ fetchSSE: fetchSSEMock }));

const formValues = {
  version: {
    configData: {
      llm: { model: "openai/gpt-5-mini" },
      messages: [{ role: "user", content: "answer it" }],
      inputs: [],
      outputs: [{ identifier: "output", type: "str" }],
    },
  },
} as unknown as PromptConfigFormValues;

/** Drives the hook's event handler with a scripted stream. */
function respondWith(events: Record<string, unknown>[]) {
  fetchSSEMock.mockImplementation(
    async ({ onEvent }: { onEvent: (event: unknown) => void }) => {
      for (const event of events) onEvent(event);
    },
  );
}

function setup(onMessagesChange = vi.fn()) {
  const rendered = renderHook(() =>
    usePromptExecution({
      projectId: "proj-1",
      formValues,
      variables: [],
      initialMessages: [],
      onMessagesChange,
    }),
  );
  return { ...rendered, onMessagesChange };
}

beforeEach(() => {
  fetchSSEMock.mockReset();
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
});

describe("usePromptExecution", () => {
  describe("when a reply streams back", () => {
    /** @scenario "Sending a message streams the reply as it arrives" */
    it("appends each delta to the assistant reply", async () => {
      respondWith([
        { type: "start", messageId: "trace-1", traceId: "trace-1" },
        { type: "delta", content: "Hel" },
        { type: "delta", content: "lo" },
        { type: "delta", content: " world" },
        { type: "done" },
      ]);

      const { result } = setup();
      await act(async () => {
        await result.current.send("hi");
      });

      await waitFor(() => {
        expect(result.current.messages).toHaveLength(2);
      });
      expect(result.current.messages[1]).toMatchObject({
        id: "trace-1",
        role: "assistant",
        content: "Hello world",
        trace_id: "trace-1",
      });
    });

    it("records the user turn before the reply arrives", async () => {
      respondWith([{ type: "done" }]);

      const { result } = setup();
      await act(async () => {
        await result.current.send("hi");
      });

      expect(result.current.messages[0]).toMatchObject({
        role: "user",
        content: "hi",
      });
    });

    /** @scenario "A refresh restores the conversation including the latest reply" */
    it("persists the settled conversation once the run ends", async () => {
      respondWith([
        { type: "start", messageId: "trace-1", traceId: "trace-1" },
        { type: "delta", content: "answer" },
        { type: "done" },
      ]);

      const { result, onMessagesChange } = setup();
      await act(async () => {
        await result.current.send("hi");
      });

      const lastPersist = onMessagesChange.mock.calls.at(-1)?.[0];
      expect(lastPersist).toHaveLength(2);
      expect(lastPersist[1]).toMatchObject({ content: "answer" });
    });
  });

  describe("when the run fails", () => {
    /** @scenario "A provider failure shows our copy, not the provider's sentence" */
    it("records the failure against the turn that failed", async () => {
      respondWith([
        { type: "start", messageId: "trace-1", traceId: "trace-1" },
        {
          type: "error",
          error: { type: "rate_limit", message: "provider said 429" },
        },
        { type: "done" },
      ]);

      const { result } = setup();
      await act(async () => {
        await result.current.send("hi");
      });

      expect(result.current.errors["trace-1"]).toMatchObject({
        type: "rate_limit",
      });
    });

    /** @scenario "A configuration failure is reported in the conversation" */
    it("reports a stream that never opened", async () => {
      fetchSSEMock.mockRejectedValue(new Error("Model is not set"));

      const { result } = setup();
      await act(async () => {
        await result.current.send("hi");
      });

      const failures = Object.values(result.current.errors);
      expect(failures).toHaveLength(1);
      expect(failures[0]).toMatchObject({
        type: "unknown",
        message: "Model is not set",
      });
    });
  });

  describe("when the user stops a run", () => {
    /** @scenario "Stopping a running execution cancels it" */
    it("aborts the stream and keeps what already arrived", async () => {
      let capturedSignal: AbortSignal | undefined;
      fetchSSEMock.mockImplementation(
        async ({
          onEvent,
          signal,
        }: {
          onEvent: (event: unknown) => void;
          signal?: AbortSignal;
        }) => {
          capturedSignal = signal;
          onEvent({ type: "start", messageId: "trace-1", traceId: "trace-1" });
          onEvent({ type: "delta", content: "partial" });
        },
      );

      const { result } = setup();
      const running = act(async () => {
        await result.current.send("hi");
      });
      await running;

      act(() => result.current.stop());

      expect(capturedSignal).toBeDefined();
      expect(result.current.messages.at(-1)).toMatchObject({
        content: "partial",
      });
    });

    /** @scenario "Stopping a running execution cancels it" */
    it("records no failure when the abort rejects the stream", async () => {
      // The sibling test's mock RESOLVES before `stop()` runs, so the abort
      // path it is named for never executes. This one hangs until the signal
      // fires and then rejects the way `fetchSSE` really does.
      fetchSSEMock.mockImplementation(
        async ({
          onEvent,
          signal,
        }: {
          onEvent: (event: unknown) => void;
          signal?: AbortSignal;
        }) => {
          onEvent({ type: "start", messageId: "trace-1", traceId: "trace-1" });
          onEvent({ type: "delta", content: "partial" });
          await new Promise((_resolve, reject) => {
            signal?.addEventListener("abort", () => {
              const error = new Error("The operation was aborted.");
              error.name = "AbortError";
              reject(error);
            });
          });
        },
      );

      const { result } = setup();
      const running = act(async () => {
        await result.current.send("hi");
      });
      act(() => result.current.stop());
      await running;

      // Stopping is a thing the user asked for, not a thing that went wrong.
      expect(Object.values(result.current.errors)).toHaveLength(0);
      expect(result.current.isRunning).toBe(false);
      // And what already streamed is still there.
      expect(result.current.messages.at(-1)).toMatchObject({
        content: "partial",
      });
    });
  });

  describe("when a message is deleted", () => {
    it("drops the message and any failure recorded against it", async () => {
      respondWith([
        { type: "start", messageId: "trace-1", traceId: "trace-1" },
        { type: "error", error: { type: "auth", message: "nope" } },
        { type: "done" },
      ]);

      const { result } = setup();
      await act(async () => {
        await result.current.send("hi");
      });

      act(() => result.current.deleteMessage("trace-1"));

      expect(result.current.messages.some((m) => m.id === "trace-1")).toBe(
        false,
      );
      expect(result.current.errors["trace-1"]).toBeUndefined();
    });
  });

  describe("when there is no project yet", () => {
    it("does not send", async () => {
      const { result } = renderHook(() =>
        usePromptExecution({
          projectId: undefined,
          formValues,
          variables: [],
          initialMessages: [],
          onMessagesChange: vi.fn(),
        }),
      );

      await act(async () => {
        await result.current.send("hi");
      });

      expect(fetchSSEMock).not.toHaveBeenCalled();
    });
  });
});
