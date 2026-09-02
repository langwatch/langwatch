/**
 * The Annotations family, as this application composes it.
 *
 * The screen, its two overlays, the sidebar and the list live in
 * `@langwatch/annotation-web`; what belongs to the application is everything
 * they are not allowed to own — which page keys the addresses answer, which
 * view each key means, the permission policy in front of them, the transport
 * their hooks run on, and the host port that turns this application's
 * capabilities into the questions the family asks.
 */

import { annotationApi } from "@langwatch/annotation-web/screens/annotations";
import { uiFeatureApi, type UiFeatureApiBinding } from "../../behavior/ui-feature-transport";
import { annotationPageLoaders } from "./ui/sections/annotation-routes";

export const annotationApiBinding: UiFeatureApiBinding = uiFeatureApi({
  name: "@langwatch/annotation-web",
  api: annotationApi,
});

export { annotationPageLoaders };
