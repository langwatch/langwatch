import type { UIMessage } from "ai";
import { type RefObject, useCallback, useRef } from "react";

import { useLangyStore } from "../../../../behavior/langy.store.ts";
import { langyDraftToRestore } from "../../../../model/langy-draft-recovery.ts";
import { useLangyDevLog } from "../stores/langy-dev-log.ts";

/** How one send behaves beyond its text. */
export interface LangySendOptions {
  /**
   * Give the text back to the composer if the send fails. False for a message the panel sends on
   * the reader's behalf: they never wrote it, so they must not be left holding it.
   */
  keepOnFailure?: boolean;
}

export type LangyPanelSend = (text: string, options?: LangySendOptions) => Promise<void>;

/**
 * Give the user their words back when a send fails. A send that never reached a turn id leaves
 * nothing running, so the composer goes back to Send along with the words.
 */
export function useLangyDraftRestore({
  lastSentTextRef,
}: {
  lastSentTextRef: RefObject<string | null>;
}) {
  const setDraft = useLangyStore((s) => s.setDraft);
  return useCallback(() => {
    const text = langyDraftToRestore({
      sentText: lastSentTextRef.current,
      draft: useLangyStore.getState().draft,
    });
    lastSentTextRef.current = null;
    if (text) setDraft(text);
    useLangyStore.getState().abandonSend();
  }, [setDraft, lastSentTextRef]);
}

/** The outbound lane's label for a send: its first 60 characters. */
function sendLabel(text: string): string {
  return text.length > 60 ? `${text.slice(0, 60)}…` : text;
}

/**
 * The panel's send, kept stable for the composer while its implementation reads this render's
 * context. `/feedback` is a client command: it summons the rating card and sends nothing.
 */
export function useLangyPanelSend({
  projectId,
  isBusy,
  latestAssistantMessageId,
  lastSentTextRef,
  resetRecovery,
  sendMessage,
  restoreDraftOnFailure,
}: {
  projectId: string | undefined;
  isBusy: boolean;
  latestAssistantMessageId: string | undefined;
  lastSentTextRef: RefObject<string | null>;
  resetRecovery: () => void;
  sendMessage: (message: Pick<UIMessage, "role" | "parts">) => Promise<void>;
  restoreDraftOnFailure: () => void;
}): LangyPanelSend {
  const setDraft = useLangyStore((s) => s.setDraft);
  const implementationRef = useRef<LangyPanelSend>(async () => undefined);
  implementationRef.current = async (text, { keepOnFailure = true } = {}) => {
    if (!text.trim() || !projectId || isBusy) return;
    setDraft("");
    if (text.trim().toLowerCase() === "/feedback") {
      if (latestAssistantMessageId) useLangyStore.getState().pinFeedback(latestAssistantMessageId);
      return;
    }
    // A new question opens a new recovery chain: the attempt budget is per question.
    resetRecovery();
    // Remembered for restoreDraftOnFailure: `sendMessage` routes failures to useChat's `error`.
    lastSentTextRef.current = keepOnFailure ? text : null;
    // The turn is in flight from HERE: Stop is available at once, and a click
    // before the turn is named is kept and dispatched as soon as it is.
    useLangyStore.getState().beginSend();
    try {
      useLangyDevLog.getState().recordOutbound("send", sendLabel(text), {
        text,
        conversationId: useLangyStore.getState().activeConversationId,
      });
      await sendMessage({ role: "user", parts: [{ type: "text", text }] });
    } catch {
      restoreDraftOnFailure();
    }
  };
  return useCallback<LangyPanelSend>(
    (text, options) => implementationRef.current(text, options),
    [],
  );
}
