/**
 * The Workflows family: two screens mounted from @langwatch/workflow-process.
 */

import type { ComponentType } from "react";

export type WorkflowScreenLoader = () => Promise<{ default: ComponentType }>;

export const workflowScreens = {
  workflows: () => import("./workflows.screen.tsx"),
  workflowChat: () => import("./workflow-chat.screen.tsx"),
} as const satisfies Record<string, WorkflowScreenLoader>;

export type WorkflowScreenName = keyof typeof workflowScreens;

export { WORKFLOWS_PAGE_PERMISSION } from "./workflows.screen.tsx";
export { api } from "@langwatch/browser-trpc/workflow-api";
export type {
  WorkflowApiMap,
  WorkflowOrganizationGraph,
} from "@langwatch/browser-trpc/workflow-api";
export {
  WorkflowHostApi,
  WorkflowHostProvider,
  type WorkflowCopyTarget,
  type WorkflowFailureNotice,
  type WorkflowRouteReading,
  type WorkflowScope,
  type WorkflowSuccessNotice,
} from "@langwatch/workflow-browser-kit";

/**
 * The Optimization Studio, `/:project/studio/:workflow` — the third
 * address, with its own loader since the screen is lazy: `apps/ui`
 * compiles whatever re-exports here, so nothing of it is named directly.
 */
export type StudioScreenLoader = () => Promise<{ default: ComponentType }>;

export const studioScreens = {
  studio: () => import("./studio.screen.tsx"),
} as const satisfies Record<string, StudioScreenLoader>;

export type StudioScreenName = keyof typeof studioScreens;
