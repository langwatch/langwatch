import { defineSlice } from "@langwatch/browser-host/global-store";
import type { ChatLayout } from "@langwatch/trace-contract/transcript";

/**
 * Shared chat-layout preference across every IOViewer instance.
 */
interface ChatLayoutPrefState {
  chatLayout: ChatLayout;
  setChatLayout: (next: ChatLayout) => void;
}

export const useChatLayoutPref = defineSlice<ChatLayoutPrefState>({
  name: "trace:chat-layout-pref",
  create: (set) => ({
    chatLayout: "thread",
    setChatLayout: (next) => set({ chatLayout: next }),
  }),
});
