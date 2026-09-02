/**
 * The Annotation Scoring family, as this application composes it.
 *
 * The screen, its editor and their transport live in
 * `@langwatch/annotation-web/screens/annotation-scores`; what belongs to the
 * application is the page key, the permission policy, the settings chrome, the
 * transport Provider, the drawer registration and the host port.
 *
 * IT IS ITS OWN FEATURE ROOT rather than part of `features/annotation`, and the
 * package's second screen scope for the same reason: the four annotations LIST
 * keys moved as their own family, and widening theirs to carry a settings page
 * that arrived later would tangle two moves. The transports share a React Query
 * cache — `createFeatureApi` keys on the procedure path — so the list's counts
 * still refresh when this page toggles a definition off.
 */

import { annotationScoresApi } from "@langwatch/annotation-web/screens/annotation-scores";
import { lazyDrawer, type UiDrawerRegistry } from "@langwatch/ui-drawer";
import { uiFeatureApi, type UiFeatureApiBinding } from "../../behavior/ui-feature-transport";
import { ANNOTATION_SCORE_EDITOR_DRAWER } from "./behavior/annotation-scores-host.adapter";
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
