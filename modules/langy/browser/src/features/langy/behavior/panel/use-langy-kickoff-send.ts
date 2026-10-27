import type { UIMessage } from "ai";
import { type RefObject, useEffect } from "react";

import { useLangyStore } from "../../../../behavior/langy.store.ts";
import { toEngineParts } from "../../model/langy-engine-parts.ts";
import { useLangyDevLog } from "../stores/langy-dev-log.ts";

/**
 * Drains a queued kickoff (the guided onboarding's handover): consumed first so it sends once,
 * and gated on an idle panel with a model and, for an attached conversation, loaded history.
 * @see specs/langy/langy-guided-onboarding.feature
 */
export function useLangyKickoffSend({
  projectId,
  isBusy,
  isRestoring,
  modelQueriesSettled,
  langyNeedsModel,
  resetEngine,
  resetRecovery,
  sendMessage,
  kickoffNamedRef,
}: {
  projectId: string | undefined;
  isBusy: boolean;
  isRestoring: boolean;
  modelQueriesSettled: boolean;
  langyNeedsModel: boolean;
  resetEngine: (options: { clearMessages: boolean }) => void;
  resetRecovery: () => void;
  sendMessage: (message: Pick<UIMessage, "role" | "parts">) => Promise<void>;
  kickoffNamedRef: RefObject<((conversationId: string) => void) | null>;
}) {
  const pendingKickoff = useLangyStore((s) => s.pendingKickoff);
  const consumePendingKickoff = useLangyStore((s) => s.consumePendingKickoff);
  const ready = !!projectId && !isBusy && !isRestoring && modelQueriesSettled && !langyNeedsModel;

  useEffect(() => {
    if (!pendingKickoff || !ready) return;
    consumePendingKickoff();
    if (!pendingKickoff.conversationId) resetEngine({ clearMessages: true });
    kickoffNamedRef.current = pendingKickoff.conversationId
      ? null
      : (pendingKickoff.onConversationNamed ?? null);
    resetRecovery();
    useLangyStore.getState().beginSend();
    useLangyDevLog.getState().recordOutbound("send", "guided onboarding kickoff", {
      text: pendingKickoff.brief,
      conversationId: useLangyStore.getState().activeConversationId,
    });
    void sendMessage({
      role: "user",
      parts: toEngineParts(pendingKickoff.parts ?? [{ type: "text", text: pendingKickoff.brief }]),
    });
  }, [
    pendingKickoff,
    ready,
    consumePendingKickoff,
    resetEngine,
    resetRecovery,
    sendMessage,
    kickoffNamedRef,
  ]);
}
