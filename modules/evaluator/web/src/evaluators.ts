/**
 * The evaluators family, as the browser application mounts it: one screen at
 * `/:project/evaluators`. The owning frontend feature mounts the tRPC Provider
 * these hooks run on and the host port that answers for the project, the
 * reader's grants, the replication targets, the address and the overlays.
 */

import type { ComponentType } from "react";

export type EvaluatorScreenLoader = () => Promise<{ default: ComponentType }>;

export const evaluatorScreens = {
  evaluators: () => import("./ui/sections/evaluators.screen.tsx"),
} as const satisfies Record<string, EvaluatorScreenLoader>;

export type EvaluatorScreenName = keyof typeof evaluatorScreens;

export { EVALUATORS_PAGE_PERMISSION } from "./ui/sections/evaluators.screen.tsx";
export { evaluatorApi } from "./behavior/evaluator-api.ts";
export type {
  EvaluatorApiMap,
  EvaluatorCascadeArchiveResult,
  EvaluatorRelatedEntities,
} from "./behavior/evaluator-api.ts";
export {
  EvaluatorHostApi,
  EvaluatorHostProvider,
  type EvaluatorCopyTarget,
  type EvaluatorFailureNotice,
  type EvaluatorOverlayRequest,
  type EvaluatorRouteReading,
  type EvaluatorScope,
  type EvaluatorSuccessNotice,
} from "./model/evaluator-host.ts";
