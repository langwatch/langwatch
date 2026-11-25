/**
 * useLangyChatEngine refreshes the app lists a Langy write touched, as the result lands.
 * @see specs/langy/langy-dashboard-widget-refresh.feature
 * @vitest-environment jsdom
 */
import type { LangyMessageDto, LangyTurnProjectionState } from "@langwatch/langy-contract";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Router names whose router-level `invalidate()` ran, in call order. */
const invalidatedRouters: string[] = [];

let chatMessages: unknown[] = [];

vi.mock("@ai-sdk/react", () => ({
  useChat: () => ({
    messages: chatMessages,
    sendMessage: vi.fn(),
    stop: vi.fn(),
    status: "streaming",
    setMessages: (next: unknown[]) => {
      chatMessages = next;
    },
    error: null,
    regenerate: vi.fn(),
    clearError: vi.fn(),
  }),
}));

// tRPC's utils answer every router path; this one records which routers were invalidated.
vi.mock("../../../../behavior/langy-api.ts", () => ({
  api: {
    useUtils: () =>
      new Proxy(
        {},
        {
          get: (_target, router) => ({
            invalidate: () => {
              invalidatedRouters.push(String(router));
              return Promise.resolve();
            },
          }),
        },
      ),
  },
}));

import { useLangyStore } from "../../../../behavior/langy.store.ts";
import {
  useLangyEngineHistorySync,
  useLangyForeignTurnRehydration,
} from "../panel/use-langy-engine-sync.ts";
import { useLangyOutlivedTurnError } from "../panel/use-langy-turn-failure.ts";
import { useLangyChatEngine } from "../use-langy-chat-engine.ts";

const transport = {} as Parameters<typeof useLangyChatEngine>[0]["transport"];

const toolMessage = ({
  command,
  state = "output-available",
  id = "call-1",
}: {
  command: string;
  state?: string;
  id?: string;
}) => ({
  id: `m-${id}`,
  role: "assistant" as const,
  parts: [
    {
      type: "dynamic-tool",
      toolName: "bash",
      toolCallId: id,
      state,
      input: { command },
      output: "{}",
    },
  ],
});

const invalidatedPaths = () => invalidatedRouters.toSorted();

describe("useLangyChatEngine write refresh", () => {
  beforeEach(() => {
    invalidatedRouters.length = 0;
    chatMessages = [];
  });

  describe("when Langy creates a scenario", () => {
    /** @scenario "A scenario Langy creates refreshes the scenario and suite lists" */
    it("invalidates the scenarios and suites routers", () => {
      chatMessages = [toolMessage({ command: "langwatch scenario create --name Refunds --json" })];
      renderHook(() => useLangyChatEngine({ transport }));

      expect(invalidatedPaths()).toEqual(["scenarios", "suites"]);
    });
  });

  describe("when Langy creates a test suite", () => {
    /** @scenario "A suite Langy creates refreshes the suite and scenario lists" */
    it("invalidates the suites and scenarios routers", () => {
      chatMessages = [
        toolMessage({ command: "langwatch test-suite create --name default --json" }),
      ];
      renderHook(() => useLangyChatEngine({ transport }));

      expect(invalidatedPaths()).toEqual(["scenarios", "suites"]);
    });
  });

  describe("when one shell call chains two writes", () => {
    /** @scenario "Every write in a chained command refreshes its lists" */
    it("invalidates the routers of both", () => {
      chatMessages = [
        toolMessage({ command: "langwatch prompt create a && langwatch evaluator create b" }),
      ];
      renderHook(() => useLangyChatEngine({ transport }));

      expect(invalidatedPaths()).toEqual(["evaluators", "promptTags", "prompts"]);
    });
  });

  describe("when Langy only reads", () => {
    /** @scenario "A read does not refresh anything" */
    it("invalidates nothing", () => {
      chatMessages = [toolMessage({ command: "langwatch scenario list --json" })];
      renderHook(() => useLangyChatEngine({ transport }));

      expect(invalidatedRouters).toEqual([]);
    });
  });

  describe("when the write has not returned yet", () => {
    it("invalidates nothing", () => {
      chatMessages = [
        toolMessage({ command: "langwatch scenario create --name A", state: "input-available" }),
      ];
      renderHook(() => useLangyChatEngine({ transport }));

      expect(invalidatedRouters).toEqual([]);
    });
  });

  describe("when the panel re-renders with the same result", () => {
    /** @scenario "A write is refreshed once, not on every render" */
    it("does not invalidate again", () => {
      chatMessages = [toolMessage({ command: "langwatch scenario create --name A" })];
      const { rerender } = renderHook(() => useLangyChatEngine({ transport }));
      // Streaming hands the engine a fresh messages array every chunk, holding the same call.
      chatMessages = [toolMessage({ command: "langwatch scenario create --name A" })];
      rerender();

      expect(invalidatedPaths()).toEqual(["scenarios", "suites"]);
    });
  });

  describe("when a stored conversation is loaded", () => {
    const storedWrite: LangyMessageDto = {
      ...toolMessage({ command: "langwatch scenario create --name Old", id: "old-call" }),
      createdAtMs: 0,
    };

    /** @scenario "Loading a stored conversation does not refresh its old writes" */
    it("does not invalidate for the writes already in its history", () => {
      const { result, rerender } = renderHook(() => useLangyChatEngine({ transport }));
      act(() => result.current.loadStoredHistory([storedWrite]));
      rerender();

      expect(chatMessages).toHaveLength(1);
      expect(invalidatedRouters).toEqual([]);
    });

    it("still invalidates for a write that settles after it", () => {
      const { result, rerender } = renderHook(() => useLangyChatEngine({ transport }));
      act(() => result.current.loadStoredHistory([storedWrite]));
      rerender();
      chatMessages = [
        ...chatMessages,
        toolMessage({ command: "langwatch evaluator create b", id: "new-call" }),
      ];
      rerender();

      expect(invalidatedRouters).toEqual(["evaluators"]);
    });

    it("invalidates for a stored call that was still running and settles later", () => {
      const runningWrite: LangyMessageDto = {
        ...toolMessage({ command: "langwatch evaluator create b", state: "input-available" }),
        createdAtMs: 0,
      };
      const { result, rerender } = renderHook(() => useLangyChatEngine({ transport }));
      act(() => result.current.loadStoredHistory([runningWrite]));
      rerender();
      chatMessages = [toolMessage({ command: "langwatch evaluator create b" })];
      rerender();

      expect(invalidatedRouters).toEqual(["evaluators"]);
    });
  });

  describe("when history reaches the engine from the record", () => {
    const conversationId = "conv-1";
    const recorded = (message: ReturnType<typeof toolMessage>): LangyMessageDto => ({
      ...message,
      createdAtMs: 0,
    });
    const oldWrite = recorded(
      toolMessage({ command: "langwatch scenario create --name Old", id: "old-call" }),
    );
    const laterWrite = recorded(
      toolMessage({ command: "langwatch evaluator create b", id: "later-call" }),
    );

    /** The panel's wiring: a conversation the user opens, then turns another tab ran. */
    const useOpenedConversation = ({ history }: { history: LangyMessageDto[] }) => {
      const engine = useLangyChatEngine({ transport });
      const sync = {
        activeConversationId: conversationId,
        historyMessages: history,
        isFetchingHistory: false,
      };
      useLangyEngineHistorySync({ ...sync, loadStoredHistory: engine.loadStoredHistory });
      useLangyForeignTurnRehydration({
        ...sync,
        isBusy: false,
        engineMessageCount: engine.messages.length,
        applyHistoryToEngine: engine.applyHistoryToEngine,
      });
      return engine;
    };

    beforeEach(() => {
      useLangyStore.setState({ historyLoadConversationId: conversationId });
    });

    /** @scenario "Loading a stored conversation does not refresh its old writes" */
    it("does not invalidate for the writes in a conversation the user opens", () => {
      const { rerender } = renderHook(useOpenedConversation, {
        initialProps: { history: [oldWrite] },
      });
      rerender({ history: [oldWrite] });

      expect(chatMessages).toHaveLength(1);
      expect(invalidatedRouters).toEqual([]);
    });

    /** @scenario "A write a turn in another tab made refreshes this tab's lists" */
    it("invalidates for a write a foreign turn brings in, and only for that one", () => {
      const { rerender } = renderHook(useOpenedConversation, {
        initialProps: { history: [oldWrite] },
      });
      rerender({ history: [oldWrite] });
      rerender({ history: [oldWrite, laterWrite] });
      rerender({ history: [oldWrite, laterWrite] });

      expect(chatMessages).toHaveLength(2);
      expect(invalidatedRouters).toEqual(["evaluators"]);
    });

    /** @scenario "A write a dropped stream never showed refreshes when the record restores it" */
    it("invalidates for a write a failure-recovery reload brings in", () => {
      const completion = { acceptedAt: 2_000, eventId: "evt-2" };
      const projection = (status: string): LangyTurnProjectionState => ({
        turnId: "turn-9",
        cursor: completion,
        turn: { Status: status } as LangyTurnProjectionState["turn"],
      });
      useLangyStore.setState({
        historyLoadConversationId: null,
        activeTurnId: "turn-9",
        turnProjection: projection("running"),
      });
      const streamDropped = new Error("stream dropped");
      type TranscriptRead = {
        transcript: LangyMessageDto[];
        transcriptCursor: typeof completion | null;
      };
      const useRecoveringTurn = ({ transcript, transcriptCursor }: TranscriptRead) => {
        const engine = useLangyChatEngine({ transport });
        useLangyOutlivedTurnError({
          error: streamDropped,
          transcriptMessages: transcript,
          transcriptCursor,
          isFetchingTranscript: false,
          clearError: engine.clearError,
          applyHistoryToEngine: engine.applyHistoryToEngine,
        });
        return engine;
      };
      const noTranscript: TranscriptRead = {
        transcript: [],
        transcriptCursor: null,
      };
      const { rerender } = renderHook(useRecoveringTurn, { initialProps: noTranscript });

      act(() => useLangyStore.setState({ turnProjection: projection("completed") }));
      rerender({ transcript: [laterWrite], transcriptCursor: completion });
      rerender({ transcript: [laterWrite], transcriptCursor: completion });

      expect(chatMessages).toHaveLength(1);
      expect(invalidatedRouters).toEqual(["evaluators"]);
    });
  });
});
