import type { ChatLayout } from "@langwatch/trace-contract/transcript";
import { create } from "zustand";

/**
 * Shared chat-layout preference across every IOViewer instance.
 */
interface ChatLayoutPrefState {
  chatLayout: ChatLayout;
  setChatLayout: (next: ChatLayout) => void;
}

export const useChatLayoutPref = create<ChatLayoutPrefState>((set) => ({
  chatLayout: "thread",
  setChatLayout: (next) => set({ chatLayout: next }),
}));
