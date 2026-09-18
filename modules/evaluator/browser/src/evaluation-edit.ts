/**
 * The legacy online-evaluation edit form: one screen, two addresses
 * (`/:project/evaluations/:id/edit`, `.../edit/choose`). Mounts the
 * WORKFLOW host (`@langwatch/workflow-browser/studio-host/*`).
 */

import type { ComponentType } from "react";

export type EvaluationEditScreenLoader = () => Promise<{ default: ComponentType }>;

export const evaluationEditScreens = {
  evaluationEdit: () => import("./ui/sections/evaluation-edit.screen.tsx"),
} as const satisfies Record<string, EvaluationEditScreenLoader>;

export type EvaluationEditScreenName = keyof typeof evaluationEditScreens;
