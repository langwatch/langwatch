/**
 * The Workflows family: TWO SCREENS, TWO ADDRESSES. `/:project/studio/:workflow` stays in `platform/app`, blocked on its COPY set size — see dev/docs/plans/ui-family-move-manifests.md. WHY THIS PACKAGE: every call here is `workflow.*`/`optimization.*`, both mounted from `@langwatch/workflow-server`.
 */

import type { ComponentType } from "react";

export type WorkflowScreenLoader = () => Promise<{ default: ComponentType }>;

export const workflowScreens = {
  workflows: () => import("./workflows.screen"),
  workflowChat: () => import("./workflow-chat.screen"),
} as const satisfies Record<string, WorkflowScreenLoader>;

export type WorkflowScreenName = keyof typeof workflowScreens;

export { WORKFLOWS_PAGE_PERMISSION } from "./workflows.screen";
export { workflowApi } from "../../model/workflow-api";
export type { WorkflowApiMap, WorkflowOrganizationGraph } from "../../model/workflow-api";
export {
  WorkflowHostPort,
  WorkflowHostProvider,
  type WorkflowCopyTarget,
  type WorkflowFailureNotice,
  type WorkflowRouteReading,
  type WorkflowScope,
  type WorkflowSuccessNotice,
} from "../../model/workflow-host";

/**
 * The Optimization Studio, `/:project/studio/:workflow` — the third
 * address, with its own loader since the screen is lazy: `apps/ui`
 * compiles whatever re-exports here, so nothing of it is named directly.
 */
export type StudioScreenLoader = () => Promise<{ default: ComponentType }>;

export const studioScreens = {
  studio: () => import("./studio.screen"),
} as const satisfies Record<string, StudioScreenLoader>;

export type StudioScreenName = keyof typeof studioScreens;
