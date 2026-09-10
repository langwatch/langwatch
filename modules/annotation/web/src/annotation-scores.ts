import type { ComponentType } from "react";

export type AnnotationScoresScreenLoader = () => Promise<{ default: ComponentType }>;

export const annotationScoresScreens = {
  annotationScores: () => import("./ui/sections/annotation-scores-screen.tsx"),
} as const satisfies Record<string, AnnotationScoresScreenLoader>;

export type AnnotationScoresScreenName = keyof typeof annotationScoresScreens;

export { ANNOTATION_SCORES_PAGE_PERMISSION } from "./ui/sections/annotation-scores-screen.tsx";
export { AnnotationScoreDrawer } from "./ui/sections/annotation-score-drawer.tsx";
export { AnnotationScoreForm } from "./ui/sections/annotation-score-form.tsx";
export { annotationScoresApi } from "./behavior/annotation-scores-api.ts";
export {
  AnnotationScoresHostApi,
  AnnotationScoresHostProvider,
  type AnnotationScoreEditorAddress,
  type AnnotationScoresFailureNotice,
  type AnnotationScoresProject,
  type AnnotationScoresSuccessNotice,
} from "./model/annotation-scores-host.ts";
