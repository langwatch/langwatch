/**
 * Which page key the Annotation Scoring address answers, and what it is wrapped in.
 *
 * ONE KEY, ONE SCREEN, and the same three wrappers in the same order as every
 * other settings family: the host outermost, the harvested settings chrome
 * inside it, and the platform page's own `annotations:view` grant innermost.
 *
 * THE GRANT OPENS THE PAGE AND DOES NOT OPEN THE WRITES. A lite member reads
 * the definitions and is offered neither the switch, the menu nor the add
 * button, which is the split `useLiteMemberGuard` made on the platform page and
 * the host port carries here.
 */

import { annotationScoresScreens } from "@langwatch/annotation-web/screens/annotation-scores";
import type { ComponentType } from "react";

import type { UiPageLoader, UiPageLoaderRegistry } from "../../../../behavior/ui-page-loaders";
import {
  UiPageForbidden,
  UiPageLoading,
  UiPageNotFound,
} from "../../../../ui/elements/ui-page-fallbacks";
import { withUiPageGuard } from "../../../../ui/sections/ui-page-guard";
import { withUiSettingsLayout } from "../../../../ui/sections/ui-settings-layout";
import { ANNOTATION_SCORES_PAGE_PERMISSION } from "../../behavior/annotation-scores-host.adapter";
import { withAnnotationScoresHost } from "./annotation-scores-host-provider";

const FALLBACKS = {
  loading: UiPageLoading,
  notFound: UiPageNotFound,
  forbidden: UiPageForbidden,
};

const annotationScoresPage: UiPageLoader = async () => {
  const module = await annotationScoresScreens.annotationScores();
  const guarded = withUiPageGuard({
    permission: ANNOTATION_SCORES_PAGE_PERMISSION,
    fallbacks: FALLBACKS,
  })(module.default as ComponentType);
  guarded.displayName = "AnnotationScoresPage";
  return { default: withAnnotationScoresHost(withUiSettingsLayout(guarded)) };
};

export const annotationScoresPageLoaders: UiPageLoaderRegistry = {
  "pages/settings/annotation-scores": annotationScoresPage,
};
