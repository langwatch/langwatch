/**
 * The annotation-scores family, as the browser application mounts it.
 *
 * ONE SCREEN AND ONE OVERLAY, at `/settings/annotation-scores`.
 *
 * WHY IT IS A SECOND SCOPE IN THIS PACKAGE rather than part of
 * `./screens/annotations`: the four annotations LIST keys moved as their own
 * family and this settings page moved separately, so it brings its own
 * transport, its own host port and its own overlay rather than widening a
 * neighbour's mid-flight. The transports share a cache — `createFeatureApi`
 * keys on the procedure path — which is what makes the list's counts refresh
 * when this page toggles a definition off.
 *
 * WHAT THE OWNING FRONTEND FEATURE HAS TO MOUNT is the tRPC Provider these
 * hooks run on, the host port that answers for the project, the lite-member
 * flag, the editor's address and the two notices, and the overlay in its drawer
 * registry.
 */

import type { ComponentType } from "react";

export type AnnotationScoresScreenLoader = () => Promise<{ default: ComponentType }>;

export const annotationScoresScreens = {
  annotationScores: () => import("./annotation-scores.screen"),
} as const satisfies Record<string, AnnotationScoresScreenLoader>;

export type AnnotationScoresScreenName = keyof typeof annotationScoresScreens;

export { ANNOTATION_SCORES_PAGE_PERMISSION } from "./annotation-scores.screen";
export { AnnotationScoreDrawer } from "./annotation-score-drawer";
export { AnnotationScoreForm } from "./annotation-score-form";
export {
  annotationScoresApi,
  type AnnotationScoresApiMap,
  type AnnotationScoreUpsertInput,
} from "./annotation-scores-api";
export {
  AnnotationScoresHostPort,
  AnnotationScoresHostProvider,
  type AnnotationScoreEditorAddress,
  type AnnotationScoresFailureNotice,
  type AnnotationScoresProject,
  type AnnotationScoresSuccessNotice,
} from "./annotation-scores-host";
