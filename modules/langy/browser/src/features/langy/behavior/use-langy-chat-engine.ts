import { useChat } from "@ai-sdk/react";
import { isHandledByGlobalHandler } from "@langwatch/browser-host/errors";
import type { LangyMessageDto } from "@langwatch/langy-contract";
import type { UIMessage } from "ai";
import { useCallback, useEffect, useRef } from "react";

import { api } from "../../../behavior/langy-api.ts";
import { isLangyTranscriptMessage } from "../../../model/langy-transcript.ts";
import { toEngineMessage } from "../model/langy-engine-parts.ts";
import type { createLangyChatTransport } from "./logic/langy-chat-transport.ts";

/**
 * The panel's chat ENGINE as one owned seam: the `useChat` transport state plus the
 * only two operations that may write to it from outside a live turn — hydrating a
 * stored history into it, and resetting it.
 */
export function useLangyChatEngine({
  transport,
}: {
  transport: ReturnType<typeof createLangyChatTransport>;
}) {
  const {
    messages,
    sendMessage,
    stop,
    status,
    setMessages,
    error,
    regenerate,
    clearError,
    resumeStream,
  } = useChat({
    transport,
    onError: (error) => {
      // Global-handled errors (license / lite-member) are owned by their own
      // handler — leave them to it.
      if (isHandledByGlobalHandler(error)) return;
      // Every live turn failure is already surfaced inline — as the recovering
      // line, the GitHub connect card, or a <LangyError> card, which falls
      // back to a generic card even for a non-structured error. A toast would
      // double the same failure on a second surface, so we never raise one
      // here: one calm surface only.
    },
  });

  // Langy can mutate dashboard widgets mid-turn, read via dashboardWidgets.list
  // and graphs.getAll, so invalidate both once on the in-flight -> settled
  // transition (a ref, not state, tracks prior status to avoid re-firing).
  const utils = api.useUtils();
  const previousStatusRef = useRef(status);
  useEffect(() => {
    const wasInFlight =
      previousStatusRef.current === "submitted" || previousStatusRef.current === "streaming";
    const isSettled = status === "ready" || status === "error";
    if (wasInFlight && isSettled) {
      void utils.dashboardWidgets.list.invalidate();
      void utils.graphs.getAll.invalidate();
    }
    previousStatusRef.current = status;
  }, [status, utils]);

  // useChat's setMessages identity is not guaranteed stable across renders.
  // Capture it in a ref so callers' effects key on real state changes (a
  // conversation-id transition) without re-firing every render — which would
  // loop against setMessages and wipe the in-flight turn.
  const setMessagesRef = useRef(setMessages);
  setMessagesRef.current = setMessages;

  const applyHistoryToEngine = useCallback((history: LangyMessageDto[]) => {
    const uiMessages = history
      .filter(isLangyTranscriptMessage)
      // `recorded` marks a message off the durable fold: a card fence still in its
      // TEXT is one the relay decided was not a block (ADR-060 §1). Its `parts`
      // were stored VERBATIM off the stream and re-enter the engine checked.
      .map((m) =>
        toEngineMessage({ id: m.id, role: m.role, parts: m.parts, metadata: { recorded: true } }),
      );
    setMessagesRef.current(uiMessages);
  }, []);

  const retryTurn = useRetryKeepingFailedReply({ messages, regenerate, setMessagesRef });

  const resetEngine = useCallback(
    ({ clearMessages }: { clearMessages: boolean }) => {
      void stop();
      clearError();
      if (clearMessages) applyHistoryToEngine([]);
    },
    [stop, clearError, applyHistoryToEngine],
  );

  return {
    messages,
    sendMessage,
    stop,
    status,
    error,
    regenerate,
    /**
     * Re-drive the last turn after it failed, keeping what the failed turn already did (its plan,
     * its tool calls, its partial answer) on screen. The retried turn continues the same agent
     * session, so that work is still the context it runs in.
     */
    retryTurn,
    /**
     * Reattach to a turn this tab did not dispatch (the transport's `getResumeTarget` names it).
     * The stream writes into a new assistant message, or the last one when it already is one.
     */
    resumeStream,
    applyHistoryToEngine,
    resetEngine,
    /**
     * Dismiss the engine's error WITHOUT the rest of a reset — the
     * composer-notice's X (a "one turn at a time" wait is cleared, nothing
     * else changes). Full walk-away resets go through `resetEngine`.
     */
    clearError,
  };
}

/**
 * Re-drive the last turn and keep the failed reply on screen. `regenerate` drops the last
 * assistant message, but it reads the conversation before its first await, so the failed reply
 * put back right after it stays, and the retried answer lands as a new message below it.
 */
function useRetryKeepingFailedReply({
  messages,
  regenerate,
  setMessagesRef,
}: {
  messages: UIMessage[];
  regenerate: () => Promise<void>;
  setMessagesRef: { current: (update: (current: UIMessage[]) => UIMessage[]) => void };
}): () => void {
  // The messages as of the last render, read at call time so the callback is not re-created on
  // every streamed token.
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  return useCallback(() => {
    const failedReply = replyToKeepOnRetry(messagesRef.current);
    void regenerate();
    if (failedReply) {
      setMessagesRef.current((current) => [...current, failedReply]);
    }
  }, [regenerate, setMessagesRef]);
}

/**
 * The failed turn's reply, when it has something to show. `regenerate` would drop it, and with it
 * the plan card and the tool calls the turn already ran.
 */
function replyToKeepOnRetry(messages: readonly UIMessage[]): UIMessage | null {
  const last = messages.at(-1);
  if (last?.role !== "assistant" || last.parts.length === 0) {
    return null;
  }

  return last;
}
