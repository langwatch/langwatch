/**
 * The Workflows family: two screens mounted from @langwatch/workflow-server.
 */

import type { ComponentType } from "react";

export type WorkflowScreenLoader = () => Promise<{ default: ComponentType }>;

export const workflowScreens = {
  workflows: () => import("./workflows.screen.tsx"),
  workflowChat: () => import("./workflow-chat.screen.tsx"),
} as const satisfies Record<string, WorkflowScreenLoader>;

export type WorkflowScreenName = keyof typeof workflowScreens;

export { WORKFLOWS_PAGE_PERMISSION } from "./workflows.screen.tsx";
export { workflowApi } from "../../model/workflow-api.ts";
export type { WorkflowApiMap, WorkflowOrganizationGraph } from "../../model/workflow-api.ts";
export {
  WorkflowHostApi,
  WorkflowHostProvider,
  type WorkflowCopyTarget,
  type WorkflowFailureNotice,
  type WorkflowRouteReading,
  type WorkflowScope,
  type WorkflowSuccessNotice,
} from "../../model/workflow-host.ts";

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
