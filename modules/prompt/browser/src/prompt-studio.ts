/**
 * Prompt Studio, as the app mounts it (ADR-004). Exposes a LOADER, not a
 * component: the studio drags a tabbed browser, a chat runtime and six
 * dialogs that don't belong in the main chunk, since nothing here statically imports the screen.
 */

import type { ComponentType } from "react";

export type PromptScreenLoader = () => Promise<{ default: ComponentType }>;

export const promptScreens = {
  promptStudio: () => import("./ui/sections/prompt-studio/prompt-studio-screen.tsx"),
} as const satisfies Record<string, PromptScreenLoader>;

export type PromptScreenName = keyof typeof promptScreens;

export { promptApi } from "./behavior/prompt-api.ts";
export {
  PromptHostApi,
  PromptHostProvider,
  type PromptCopyTarget,
  type PromptFailureNotice,
  type PromptHostScope,
  type PromptPlaygroundChatAvailability,
  type PromptPlatformDrawer,
  type PromptRouteReading,
  type PromptSuccessNotice,
} from "./model/prompt-host.ts";
