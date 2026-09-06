import { createContext, useContext } from "react";

/**
 * Drives per-message expand/collapse in the conversation view. The shared
 * Bubble is also used by the trace table's compact conversation preview,
 * where there's no provider — so `isExpandable` defaults to false there and
 * the table keeps its plain truncated preview untouched. Inside the
 * conversation view the provider flips `isExpandable` on, and `shouldExpandAll`
 * seeds every message's local expand state (the toolbar "Expand all"
 * toggle). See specs/traces-v2/conversation-message-expand.feature
 */
export interface ConversationExpandState {
  isExpandable: boolean;
  shouldExpandAll: boolean;
}

export const ConversationExpandContext = createContext<ConversationExpandState>(
  {
    isExpandable: false,
    shouldExpandAll: false,
  },
);

export const useConversationExpand = (): ConversationExpandState =>
  useContext(ConversationExpandContext);
