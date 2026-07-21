import { useChat } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import { useCallback, useRef } from "react";

import { isHandledByGlobalHandler } from "~/utils/trpcError";

import type { LangyMessageDto } from "../data/langy.dtos";
import type { createLangyChatTransport } from "../logic/langyChatTransport";

/**
 * The panel's chat ENGINE as one owned seam: the `useChat` transport state plus
 * the only two operations that may write to it from outside a live turn —
 * hydrating a stored history into it, and resetting it.
 *
 * Everything `useChat` owns that Zustand cannot reach is reset HERE, so a
 * caller can never forget a field:
 *
 *   - the ERROR. The bug people saw: start a new chat after a failed turn and
 *     the red error card is still sitting under an empty panel, because
 *     nothing ever cleared `useChat`'s error. `clearError()` is the only thing
 *     that does. (`stop()` is a no-op once the turn has errored — it returns
 *     early unless the status is streaming/submitted — so it was never going
 *     to.)
 *   - the MESSAGES. Cleared explicitly rather than via the panel's
 *     `activeConversationId === null` effect, which only fires on a TRANSITION
 *     to null — so a new chat started from an already-null conversation (a
 *     first message that failed before the server adopted an id) left the dead
 *     messages on screen.
 *
 * What is deliberately NOT here: the recovery timer (owned by
 * `useLangyTurnRecovery`, which exposes its own `reset()`) and the backend
 * stop (a panel-level coordination of store + server). The panel composes
 * owned seams; it does not reach into this engine's internals.
 */
export function useLangyChatEngine({
  transport,
}: {
  transport: ReturnType<typeof createLangyChatTransport>;
}) {
  const { messages, sendMessage, stop, status, setMessages, error, regenerate, clearError } =
    useChat({
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

  // useChat's setMessages identity is not guaranteed stable across renders.
  // Capture it in a ref so callers' effects key on real state changes (a
  // conversation-id transition) without re-firing every render — which would
  // loop against setMessages and wipe the in-flight turn.
  const setMessagesRef = useRef(setMessages);
  setMessagesRef.current = setMessages;

  const applyHistoryToEngine = useCallback((history: LangyMessageDto[]) => {
    const uiMessages = history
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ id: m.id, role: m.role, parts: m.parts }));
    // `parts` is the part array the message projection stored VERBATIM off the
    // stream, typed on the wire as opaque records (see langyMessageSchema).
    // Re-entering the SDK's discriminated part union from that wire shape is
    // the engine's one honest cast; the renderers narrow it structurally.
    setMessagesRef.current(uiMessages as unknown as UIMessage[]);
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
    applyHistoryToEngine,
    resetEngine,
  };
}
