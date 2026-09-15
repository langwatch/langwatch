/**
 * Prompt Studio, as the browser application mounts it (ADR-004: a screen is an owner-only
 * export named after its frontend feature). It exposes a LOADER, not a component: the studio
 * drags a tabbed browser, a chat runtime, a model picker and six dialogs that don't belong in
 * the chunk that renders the rest of the app, and nothing here statically imports the screen,
 * so reaching this entry's host port never pulls those in.
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
