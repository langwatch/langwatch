/**
 * The legacy online-evaluation edit form, as the browser application mounts it.
 * Two addresses, one screen: `/:project/evaluations/:id/edit` and
 * `.../edit/choose`. The owning frontend feature mounts the WORKFLOW host —
 * the form reads `@langwatch/workflow-web/studio-host/*` for the project, the
 * transport, the router and the toasts.
 */

import type { ComponentType } from "react";

export type EvaluationEditScreenLoader = () => Promise<{ default: ComponentType }>;

export const evaluationEditScreens = {
  evaluationEdit: () => import("./ui/sections/evaluation-edit.screen.tsx"),
} as const satisfies Record<string, EvaluationEditScreenLoader>;

export type EvaluationEditScreenName = keyof typeof evaluationEditScreens;
