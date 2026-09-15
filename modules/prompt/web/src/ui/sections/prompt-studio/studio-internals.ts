/**
 * What the studio's own modules compose each other through.
 *
 * Kept apart from `index.ts` so the PUBLIC entry stays four names - the loader,
 * the procedure map, the host port and its types. A host that mounts this
 * package to reach the port would otherwise pull the sidebar, the tab browser
 * and the chat text area into its own compile and its own chunk, and
 * `apps/ui`'s typecheck is stricter than this package's: compiling a transitive
 * dependency's source under `noImplicitReturns` turned four of
 * `@langwatch/workflow-web`'s functions into errors in a project that does not
 * own them.
 *
 * Nothing outside this package imports this file.
 */

export { PromptBrowserTab, type PromptBrowserTabProps } from "./prompt-browser-tab.tsx";
export { TabIdProvider, useTabId } from "../../../model/prompt-tab-context.tsx";
export { PromptTabSwitcher } from "./prompt-tab-switcher.tsx";
export { shouldShowVersionBadge } from "../../../model/should-show-version-badge.ts";
export { useIsOverflowing } from "./use-is-overflowing.ts";
export type {
  PromptBrowserLogger,
  PromptBrowserStorage,
  PromptTabsCapabilities,
} from "../../../model/browser-capabilities.ts";
export {
  clearPromptTabsStore,
  clearStoreInstances,
  getStoreForTesting,
  TabDataSchema,
  TabSchema,
  usePromptTabsStore,
  WindowSchema,
  type DraggableTabsBrowserState,
  type Tab,
  type TabData,
  type Window,
} from "../../../model/prompt-tabs-store.ts";
export { createTabId, createWindowId } from "../../../model/tab-id-generators.ts";
export { Sidebar } from "./prompt-studio-sidebar.tsx";
export { SidebarEmptyState } from "./prompt-studio-sidebar-empty-state.tsx";
export { ChatSendButton, type ChatSendButtonProps } from "./chat-send-button.tsx";
export { ChatSyncCheckbox, type ChatSyncCheckboxProps } from "./chat-sync-checkbox.tsx";
export { ChatTextArea, type ChatTextAreaProps } from "./chat-text-area.tsx";
export {
  PromptPlaygroundChatProvider,
  usePromptPlaygroundChatSync,
} from "../../../model/prompt-chat-sync-context.tsx";
export { ResizableDivider, type ResizableDividerProps } from "./resizable-divider.tsx";
