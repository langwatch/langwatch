/**
 * @vitest-environment jsdom
 *
 * The panel-open pre-warm hook (specs/langy/langy-worker-prewarm.feature):
 * fires the `langy.warmWorker` mutation on the panel-open rising edge and on
 * conversation change, at most once per (project, conversation) while open,
 * holds the returned id as `pendingConversationId` (never the active id), and
 * surfaces nothing on failure. The tRPC mutation is mocked; the store is the
 * real one. Visibility gating is the panel's mount gate, covered by
 * ProjectLangyLayout.integration.test.tsx, a user without Langy never mounts
 * the panel, so this hook never runs for them.
 */
import { cleanup, renderHook } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLangyStore } from "../../stores/langyStore";
import { useLangyWarmWorker } from "../useLangyWarmWorker";

type WarmInput = {
  projectId: string;
  conversationId?: string;
  modelOverride?: string;
};
type WarmResult = { conversationId: string | null; warmed: boolean };
type MutateOptions = {
  onSuccess?: (result: WarmResult) => void;
  onError?: (error: unknown) => void;
};

const mutate = vi.fn<(input: WarmInput, opts?: MutateOptions) => void>();

vi.mock("~/utils/api", () => ({
  api: {
    langy: {
      warmWorker: {
        useMutation: () => ({ mutate }),
      },
    },
  },
}));

type HookProps = Parameters<typeof useLangyWarmWorker>[0];

const props = (over: Partial<HookProps> = {}): HookProps => ({
  projectId: "proj-1",
  isOpen: true,
  conversationId: null,
  model: "openai/gpt-5-mini",
  ...over,
});

describe("useLangyWarmWorker", () => {
  beforeEach(() => {
    mutate.mockReset();
    useLangyStore.setState({
      pendingConversationId: null,
      activeConversationId: null,
    });
  });

  afterEach(() => {
    cleanup();
  });

  describe("when the panel opens with the model settled", () => {
    /** @scenario Opening the panel warms the worker for a new conversation */
    it("fires the warm exactly once, carrying the picker model", () => {
      const { rerender } = renderHook(useLangyWarmWorker, {
        initialProps: props(),
      });

      expect(mutate).toHaveBeenCalledTimes(1);
      expect(mutate.mock.calls[0]![0]).toEqual({
        projectId: "proj-1",
        modelOverride: "openai/gpt-5-mini",
      });

      // A re-render with the same key warms nothing again.
      rerender(props());
      expect(mutate).toHaveBeenCalledTimes(1);
    });

    /** @scenario A warm for a fresh chat returns a server-minted conversation id */
    it("holds the returned id as pending, never as the active conversation", () => {
      renderHook(useLangyWarmWorker, { initialProps: props() });

      const opts = mutate.mock.calls[0]![1]!;
      act(() => {
        opts.onSuccess?.({ conversationId: "conv-warmed", warmed: true });
      });

      expect(useLangyStore.getState().pendingConversationId).toBe(
        "conv-warmed",
      );
      expect(useLangyStore.getState().activeConversationId).toBeNull();
    });

    it("drops the returned id when a send already made a conversation active", () => {
      renderHook(useLangyWarmWorker, { initialProps: props() });
      useLangyStore.setState({ activeConversationId: "conv-live" });

      const opts = mutate.mock.calls[0]![1]!;
      act(() => {
        opts.onSuccess?.({ conversationId: "conv-warmed", warmed: true });
      });

      expect(useLangyStore.getState().pendingConversationId).toBeNull();
    });
  });

  describe("when the user selects a conversation while the panel is open", () => {
    /** @scenario Selecting a recent conversation warms its worker */
    it("warms the selected conversation's worker", () => {
      const { rerender } = renderHook(useLangyWarmWorker, {
        initialProps: props(),
      });
      rerender(props({ conversationId: "conv-selected" }));

      expect(mutate).toHaveBeenCalledTimes(2);
      expect(mutate.mock.calls[1]![0]).toEqual({
        projectId: "proj-1",
        conversationId: "conv-selected",
        modelOverride: "openai/gpt-5-mini",
      });
    });

    it("keeps no pending id for an existing conversation's warm", () => {
      renderHook(useLangyWarmWorker, {
        initialProps: props({ conversationId: "conv-selected" }),
      });

      const opts = mutate.mock.calls[0]![1]!;
      act(() => {
        opts.onSuccess?.({ conversationId: "conv-selected", warmed: true });
      });

      expect(useLangyStore.getState().pendingConversationId).toBeNull();
    });
  });

  describe("when the panel is closed or the model has not settled", () => {
    it("waits for the open panel", () => {
      const { rerender } = renderHook(useLangyWarmWorker, {
        initialProps: props({ isOpen: false }),
      });
      expect(mutate).not.toHaveBeenCalled();

      rerender(props({ isOpen: true }));
      expect(mutate).toHaveBeenCalledTimes(1);
    });

    it("waits for the model", () => {
      const { rerender } = renderHook(useLangyWarmWorker, {
        initialProps: props({ model: null }),
      });
      expect(mutate).not.toHaveBeenCalled();

      rerender(props({ model: "openai/gpt-5-mini" }));
      expect(mutate).toHaveBeenCalledTimes(1);
    });

    it("re-arms after a close, so the next open warms again", () => {
      const { rerender } = renderHook(useLangyWarmWorker, {
        initialProps: props(),
      });
      expect(mutate).toHaveBeenCalledTimes(1);

      rerender(props({ isOpen: false }));
      rerender(props({ isOpen: true }));
      expect(mutate).toHaveBeenCalledTimes(2);
    });
  });

  describe("when the warm fails", () => {
    it("surfaces nothing and leaves the store untouched", () => {
      renderHook(useLangyWarmWorker, { initialProps: props() });

      const opts = mutate.mock.calls[0]![1]!;
      act(() => {
        opts.onError?.(new Error("warm failed"));
      });

      expect(useLangyStore.getState().pendingConversationId).toBeNull();
    });
  });
});
