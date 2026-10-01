import { showErrorToast } from "@langwatch/browser-host/errors";
import { useLangyStore } from "@langwatch/langy-browser-kit";
import { useEffect, useEffectEvent } from "react";

import { useLangyConversationCommands } from "../data/use-langy-conversation-commands.ts";
import type { LangyPanelSend } from "./use-langy-panel-send.ts";

/**
 * Walking between conversations: New chat, switching, deleting and renaming. Leaving the current
 * conversation resets the CHAT ENGINE and the recovery chain too, not just the store — and a
 * question queued by the command bar's "Ask Langy" starts a fresh one.
 */
export function useLangyConversationNavigation({
  projectId,
  isBusy,
  send,
  resetEngine,
  resetRecovery,
  leaveReconnect,
  closeHistory,
}: {
  projectId: string | undefined;
  isBusy: boolean;
  send: LangyPanelSend;
  resetEngine: (options: { clearMessages: boolean }) => void;
  resetRecovery: () => void;
  leaveReconnect: () => void;
  closeHistory: () => void;
}) {
  const activeConversationId = useLangyStore((s) => s.activeConversationId);
  const selectConversation = useLangyStore((s) => s.selectConversation);
  const startNewConversation = useLangyStore((s) => s.startNewConversation);
  const pendingPrompt = useLangyStore((s) => s.pendingPrompt);
  const consumePendingPrompt = useLangyStore((s) => s.consumePendingPrompt);
  // `fork` is deliberately not offered: the panel has no way to branch a conversation.
  const { remove: removeConversation, rename: renameConversation } = useLangyConversationCommands();

  const resetChatEngine = ({ clearMessages }: { clearMessages: boolean }) => {
    resetEngine({ clearMessages });
    resetRecovery();
  };

  const newChat = () => {
    leaveReconnect();
    resetChatEngine({ clearMessages: true });
    startNewConversation();
    // Starting a chat means you want the chat, not the filing cabinet.
    closeHistory();
  };

  const askQueuedPrompt = useEffectEvent((prompt: string) => {
    consumePendingPrompt();
    resetChatEngine({ clearMessages: true });
    void send(prompt);
  });
  useEffect(() => {
    if (pendingPrompt && projectId && !isBusy) askQueuedPrompt(pendingPrompt);
  }, [pendingPrompt, projectId, isBusy]);

  // Messages are replaced by the selected history, so they are not blanked
  // here; picking one IS leaving the list.
  const select = (id: string) => {
    resetChatEngine({ clearMessages: false });
    selectConversation(id);
    closeHistory();
  };

  const remove = async (id: string) => {
    const wasActive = id === activeConversationId;
    try {
      await removeConversation(id);
      if (!wasActive) return;
      resetChatEngine({ clearMessages: true });
      startNewConversation();
    } catch (error) {
      showErrorToast({
        error,
        fallbackTitle: "Couldn't delete the conversation",
        description: "The conversation is still there. Try again in a moment.",
      });
    }
  };

  const rename = async (id: string, title: string) => {
    try {
      await renameConversation(id, title);
    } catch (error) {
      showErrorToast({
        error,
        fallbackTitle: "Couldn't rename the conversation",
        description: "The old name is still in place. Try again in a moment.",
      });
      throw new Error("Failed to rename conversation");
    }
  };

  return { newChat, select, remove, rename };
}
