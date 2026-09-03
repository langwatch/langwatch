/**
 * The Annotation Scoring family: screen/editor/transport live in
 * `@langwatch/annotation-web`; this owns the page key, permission, chrome,
 * transport Provider and host port — its own feature root on purpose.
 */

import { annotationScoresApi } from "@langwatch/annotation-web/screens/annotation-scores";
import { lazyDrawer, type UiDrawerRegistry } from "@langwatch/ui-drawer";
import { uiFeatureApi, type UiFeatureApiBinding } from "../../behavior/ui-feature-transport";
import { ANNOTATION_SCORE_EDITOR_DRAWER } from "./ui/sections/annotation-scores-host";
import { annotationScoresPageLoaders } from "./ui/sections/annotation-scores-routes";

export const annotationScoresApiBinding: UiFeatureApiBinding = uiFeatureApi({
  name: "@langwatch/annotation-web/screens/annotation-scores",
  api: annotationScoresApi,
});

/** The drawers this family serves, by the name the address uses. */
export const annotationScoresDrawers: UiDrawerRegistry = {
  [ANNOTATION_SCORE_EDITOR_DRAWER]: lazyDrawer({
    factory: () => import("./ui/sections/annotation-scores-drawers"),
    key: "AnnotationScoreEditorDrawer",
  }),
};

export { annotationScoresPageLoaders };
