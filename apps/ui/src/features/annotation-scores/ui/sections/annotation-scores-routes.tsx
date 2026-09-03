/**
 * Which page key the Annotation Scoring address answers, and what it wraps.
 * The `annotations:view` grant opens the page, not the writes — a lite
 * member reads definitions but gets no switch, menu or add button.
 */

import { annotationScoresScreens } from "@langwatch/annotation-web/screens/annotation-scores";
import type { ComponentType } from "react";

import type { UiPageLoaderRegistry } from "../../../../behavior/ui-page-loaders";
import { uiPage } from "../../../../ui/sections/ui-page";
import { AnnotationScoresHost } from "./annotation-scores-host";

/** The grant the platform page asked for, unchanged. */
export const ANNOTATION_SCORES_PAGE_PERMISSION = "annotations:view";

export const annotationScoresPageLoaders: UiPageLoaderRegistry = {
  "pages/settings/annotation-scores": uiPage({
    screen: async () => ({
      default: (await annotationScoresScreens.annotationScores()).default as ComponentType,
    }),
    host: AnnotationScoresHost,
    settingsLayout: true,
    permission: ANNOTATION_SCORES_PAGE_PERMISSION,
  }),
};
