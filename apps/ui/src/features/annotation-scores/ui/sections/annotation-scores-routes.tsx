/**
 * Which page key the Annotation Scoring address answers, and what it is wrapped in.
 *
 * ONE KEY, ONE SCREEN, and the same wrapping order as every other settings
 * family: the host outermost, the settings chrome inside it, and the platform
 * page's own `annotations:view` grant innermost.
 *
 * THE GRANT OPENS THE PAGE AND DOES NOT OPEN THE WRITES. A lite member reads
 * the definitions and is offered neither the switch, the menu nor the add
 * button, which is the split `useLiteMemberGuard` made on the platform page and
 * the host port carries here.
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
