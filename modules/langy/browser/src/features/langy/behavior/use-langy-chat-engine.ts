import { useChat } from "@ai-sdk/react";
import { isHandledByGlobalHandler } from "@langwatch/browser-host/errors";
import type { LangyMessageDto } from "@langwatch/langy-contract";
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
