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
  pendingConversationId: null,
  turnInFlight: false,
  model: "openai/gpt-5-mini",
  ...over,
});

describe("useLangyWarmWorker", () => {
  beforeEach(() => {
    mutate.mockReset();
    useLangyStore.setState({
      pendingConversationId: null,
      activeConversationId: null,
      warmedConversationId: null,
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

    /** @scenario A warmed fresh chat says Thinking from the first frame */
    it("records which conversation's worker the warm proved alive", () => {
      renderHook(useLangyWarmWorker, { initialProps: props() });

      const opts = mutate.mock.calls[0]![1]!;
      act(() => {
        opts.onSuccess?.({ conversationId: "conv-warmed", warmed: true });
      });

      expect(useLangyStore.getState().warmedConversationId).toBe("conv-warmed");
    });

    it("records nothing when the warm could not boot a worker", () => {
      renderHook(useLangyWarmWorker, { initialProps: props() });

      const opts = mutate.mock.calls[0]![1]!;
      act(() => {
        opts.onSuccess?.({ conversationId: "conv-cold", warmed: false });
      });

      expect(useLangyStore.getState().warmedConversationId).toBeNull();
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

  describe("when a turn is streaming", () => {
    /** @scenario No warm fires while a turn is streaming */
    it("holds every warm until the turn settles, then fires it", () => {
      // A mid-stream model switch re-arms a warm carrying the NEW picker
      // model; fired live it asked the manager for a worker the running turn
      // did not match, and the manager used to kill the turn's worker.
      const { rerender } = renderHook(useLangyWarmWorker, {
        initialProps: props({
          conversationId: "conv-live",
          turnInFlight: true,
        }),
      });
      expect(mutate).not.toHaveBeenCalled();

      rerender(
        props({
          conversationId: "conv-live",
          turnInFlight: true,
          model: "gemini/gemini-3.7-flash",
        }),
      );
      expect(mutate).not.toHaveBeenCalled();

      rerender(
        props({
          conversationId: "conv-live",
          turnInFlight: false,
          model: "gemini/gemini-3.7-flash",
        }),
      );
      expect(mutate).toHaveBeenCalledTimes(1);
      expect(mutate.mock.calls[0]![0]).toEqual({
        projectId: "proj-1",
        conversationId: "conv-live",
        modelOverride: "gemini/gemini-3.7-flash",
      });
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

    it("re-warms the held pending id instead of minting another", () => {
      const { rerender } = renderHook(useLangyWarmWorker, {
        initialProps: props(),
      });
      expect(mutate).toHaveBeenCalledTimes(1);

      const opts = mutate.mock.calls[0]![1]!;
      act(() => {
        opts.onSuccess?.({ conversationId: "conv-warmed", warmed: true });
      });

      // The panel re-renders with the held id; the warm it names already ran,
      // so nothing fires again.
      rerender(props({ pendingConversationId: "conv-warmed" }));
      expect(mutate).toHaveBeenCalledTimes(1);
    });

    it("keeps one pending id across a flip through an active conversation", () => {
      const { rerender } = renderHook(useLangyWarmWorker, {
        initialProps: props(),
      });
      const opts = mutate.mock.calls[0]![1]!;
      act(() => {
        opts.onSuccess?.({ conversationId: "conv-warmed", warmed: true });
      });

      rerender(
        props({
          conversationId: "conv-selected",
          pendingConversationId: "conv-warmed",
        }),
      );
      expect(mutate).toHaveBeenCalledTimes(2);

      // Back to the fresh chat: the pending id's worker is already warm, so
      // no third warm and no second mint.
      rerender(props({ pendingConversationId: "conv-warmed" }));
      expect(mutate).toHaveBeenCalledTimes(2);
    });

    it("re-warms the pending id on a model change, never a new mint", () => {
      const { rerender } = renderHook(useLangyWarmWorker, {
        initialProps: props(),
      });
      const opts = mutate.mock.calls[0]![1]!;
      act(() => {
        opts.onSuccess?.({ conversationId: "conv-warmed", warmed: true });
      });

      rerender(
        props({
          pendingConversationId: "conv-warmed",
          model: "anthropic/claude-opus-5",
        }),
      );
      expect(mutate).toHaveBeenCalledTimes(2);
      expect(mutate.mock.calls[1]![0]).toEqual({
        projectId: "proj-1",
        conversationId: "conv-warmed",
        modelOverride: "anthropic/claude-opus-5",
      });
    });

    /** @scenario Starting a new chat after a conversation warms again */
    it("re-arms the fresh warm once a conversation takes over", () => {
      const { rerender } = renderHook(useLangyWarmWorker, {
        initialProps: props(),
      });
      expect(mutate).toHaveBeenCalledTimes(1);
      expect(mutate.mock.calls[0]![0]).toEqual({
        projectId: "proj-1",
        modelOverride: "openai/gpt-5-mini",
      });

      rerender(props({ conversationId: "conv-adopted" }));
      expect(mutate).toHaveBeenCalledTimes(2);

      rerender(props({ conversationId: null }));
      expect(mutate).toHaveBeenCalledTimes(3);
      expect(mutate.mock.calls[2]![0]).toEqual({
        projectId: "proj-1",
        modelOverride: "openai/gpt-5-mini",
      });
    });
  });

  describe("when the user changes the model while the panel is open", () => {
    it("warms again, because the worker signature carries the model", () => {
      const { rerender } = renderHook(useLangyWarmWorker, {
        initialProps: props(),
      });
      expect(mutate).toHaveBeenCalledTimes(1);

      rerender(props({ model: "anthropic/claude-opus-5" }));
      expect(mutate).toHaveBeenCalledTimes(2);
      expect(mutate.mock.calls[1]![0]).toEqual({
        projectId: "proj-1",
        modelOverride: "anthropic/claude-opus-5",
      });

      // Back to the first model: that worker was already warmed in this open.
      rerender(props({ model: "openai/gpt-5-mini" }));
      expect(mutate).toHaveBeenCalledTimes(2);
    });

    it("keeps the newest warm's id when an older one answers last", () => {
      const { rerender } = renderHook(useLangyWarmWorker, {
        initialProps: props(),
      });
      rerender(props({ model: "anthropic/claude-opus-5" }));
      expect(mutate).toHaveBeenCalledTimes(2);

      const first = mutate.mock.calls[0]![1]!;
      const second = mutate.mock.calls[1]![1]!;
      act(() => {
        second.onSuccess?.({ conversationId: "conv-newest", warmed: true });
      });
      act(() => {
        first.onSuccess?.({ conversationId: "conv-stale", warmed: true });
      });

      expect(useLangyStore.getState().pendingConversationId).toBe(
        "conv-newest",
      );
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

    it("drops a warm that answers after the panel closed", () => {
      const { rerender } = renderHook(useLangyWarmWorker, {
        initialProps: props(),
      });
      const opts = mutate.mock.calls[0]![1]!;

      rerender(props({ isOpen: false }));
      act(() => {
        opts.onSuccess?.({ conversationId: "conv-stale", warmed: true });
      });

      // The next open warms again; adopting this id would silently reuse a
      // worker the user's close already abandoned.
      expect(useLangyStore.getState().pendingConversationId).toBeNull();
    });

    it("drops a warm that answers after the model went away", () => {
      const { rerender } = renderHook(useLangyWarmWorker, {
        initialProps: props(),
      });
      const opts = mutate.mock.calls[0]![1]!;

      rerender(props({ model: null }));
      act(() => {
        opts.onSuccess?.({ conversationId: "conv-stale", warmed: true });
      });

      expect(useLangyStore.getState().pendingConversationId).toBeNull();
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
