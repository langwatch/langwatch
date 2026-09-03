/**
 * The evaluators family, as the browser application mounts it.
 *
 * ONE SCREEN, ONE ADDRESS: `/:project/evaluators`.
 *
 * WHY THIS PACKAGE. The credentials family's rule, read strictly: a key belongs
 * to the family that owns its TRANSPORT. Every tRPC call on this page is
 * `evaluators.*`, mounted out of `@langwatch/evaluator-server`, and every type
 * on it — `Evaluator`, `EvaluatorCopy`, `EvaluatorHistoryEntry` — is
 * `@langwatch/evaluator-contract`'s. Transport and types agree, so there is
 * nothing to argue.
 *
 * WHAT THE OWNING FRONTEND FEATURE HAS TO MOUNT is the tRPC Provider this
 * package's hooks run on and the host port that answers for the project, the
 * reader's grants, the replication targets, the address, the two notices and
 * the overlays this family does not own.
 */

import type { ComponentType } from "react";

export type EvaluatorScreenLoader = () => Promise<{ default: ComponentType }>;

export const evaluatorScreens = {
  evaluators: () => import("./evaluators.screen"),
} as const satisfies Record<string, EvaluatorScreenLoader>;

export type EvaluatorScreenName = keyof typeof evaluatorScreens;

export { EVALUATORS_PAGE_PERMISSION } from "./evaluators.screen";
export { evaluatorApi } from "../../behavior/evaluator-api";
export type {
  EvaluatorApiMap,
  EvaluatorCascadeArchiveResult,
  EvaluatorRelatedEntities,
} from "../../behavior/evaluator-api";
export {
  EvaluatorHostPort,
  EvaluatorHostProvider,
  type EvaluatorCopyTarget,
  type EvaluatorFailureNotice,
  type EvaluatorOverlayRequest,
  type EvaluatorRouteReading,
  type EvaluatorScope,
  type EvaluatorSuccessNotice,
} from "../../model/evaluator-host";
