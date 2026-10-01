/**
 * The evaluators family: one screen at `/:project/evaluators`. The
 * owning feature mounts the tRPC Provider and the host port answering
 * for the project, grants, replication targets and overlays.
 */

import type { ComponentType } from "react";

export type EvaluatorScreenLoader = () => Promise<{ default: ComponentType }>;

export const evaluatorScreens = {
  evaluators: () => import("./ui/sections/evaluators.screen.tsx"),
} as const satisfies Record<string, EvaluatorScreenLoader>;

export type EvaluatorScreenName = keyof typeof evaluatorScreens;

export { evaluatorApi } from "./behavior/evaluator-api.ts";
export type {
  EvaluatorApiMap,
  EvaluatorCascadeArchiveResult,
  EvaluatorRelatedEntities,
} from "./behavior/evaluator-api.ts";
export {
  EvaluatorHostApi,
  EvaluatorHostProvider,
  EVALUATORS_PAGE_PERMISSION,
  type EvaluatorCopyTarget,
  type EvaluatorFailureNotice,
  type EvaluatorOverlayRequest,
  type EvaluatorRouteReading,
  type EvaluatorScope,
  type EvaluatorSuccessNotice,
} from "./model/evaluator-host.ts";
