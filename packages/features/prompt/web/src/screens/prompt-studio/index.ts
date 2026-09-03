/**
 * Prompt Studio, as the browser application mounts it.
 *
 * ADR-004 makes a screen an owner-only export named after the frontend feature
 * that composes it, so the whole family is one entry — one key,
 * `pages/[project]/prompts`, one screen. What it exposes for the page is a
 * LOADER rather than a component, because the studio drags a tabbed browser, a
 * chat runtime, a model picker and six dialogs behind it, and none of that
 * belongs in the chunk that renders the rest of the application.
 *
 * WHAT THE OWNING FRONTEND FEATURE HAS TO MOUNT is two things: the tRPC
 * Provider this package's hooks run on, and the host port that answers for the
 * scope, the reader's grants, the address, the two notices, the projects a
 * prompt may be copied into, the browser storage the open tabs are persisted
 * in, the upgrade prompt, and the one `platform/app` drawer this screen
 * addresses rather than mounts.
 *
 * NOTHING HERE STATICALLY IMPORTS THE SCREEN. The loader is the only path to
 * `prompt-studio.screen`, so a host that mounts this entry to reach the host
 * port or the procedure map does not pull the chat runtime, the tabbed browser
 * and the model picker into its own chunk. The page's permission is stated by
 * the frontend feature that wraps the loader, which is where the datasets and
 * model-config families put theirs for the same reason.
 *
 * The names below the entry are the studio's own internals, published here
 * because the screen's modules compose each other through this barrel. Nothing
 * outside this package imports them.
 */

import type { ComponentType } from "react";

export type PromptScreenLoader = () => Promise<{ default: ComponentType }>;

export const promptScreens = {
  promptStudio: () => import("./prompt-studio.screen"),
} as const satisfies Record<string, PromptScreenLoader>;

export type PromptScreenName = keyof typeof promptScreens;

export { promptApi } from "../../behavior/prompt-api";
export {
  PromptHostPort,
  PromptHostProvider,
  type PromptCopyTarget,
  type PromptFailureNotice,
  type PromptHostScope,
  type PromptPlaygroundChatAvailability,
  type PromptPlatformDrawer,
  type PromptRouteReading,
  type PromptSuccessNotice,
} from "../../model/prompt-host";
