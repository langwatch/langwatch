import { createContext, useContext } from "react";

/**
 * Drives per-message expand/collapse in the conversation view.
 */
export interface ConversationExpandState {
  isExpandable: boolean;
  shouldExpandAll: boolean;
}

export const ConversationExpandContext = createContext<ConversationExpandState>({
  isExpandable: false,
  shouldExpandAll: false,
});

export const useConversationExpand = (): ConversationExpandState =>
  useContext(ConversationExpandContext);
