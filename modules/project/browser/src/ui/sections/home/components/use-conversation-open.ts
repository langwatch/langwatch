import { useLangyStore } from "../../../../behavior/langy/langy.store.ts";

/** Puts the cursor in the panel's composer, once the panel is open. */
export function focusPanelComposer(): void {
  document
    .querySelector<HTMLElement>('[data-langy-composer="panel"]')
    ?.querySelector("textarea")
    ?.focus();
}

/**
 * Whether the home's field stands down: a question handed to Langy is on its way, or
 * the panel is open on a conversation. The field starts conversations and the panel's
 * composer continues them, so both never show at once.
 */
export function useConversationOpen(): {
  conversationOpen: boolean;
  continueInLangy: () => void;
} {
  const isOpen = useLangyStore((s) => s.isOpen);
  const openPanel = useLangyStore((s) => s.openPanel);
  const activeConversationId = useLangyStore((s) => s.activeConversationId);
  const pendingPrompt = useLangyStore((s) => s.pendingPrompt);
  return {
    conversationOpen: !!pendingPrompt || (isOpen && !!activeConversationId),
    continueInLangy: () => {
      openPanel();
      focusPanelComposer();
    },
  };
}
