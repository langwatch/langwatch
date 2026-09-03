/**
 * The project home, as this application composes it.
 *
 * The page lives in `@langwatch/project-web`; what belongs to the application
 * is the page key it answers, the `return_to` redirect that wraps it, the
 * transport its hooks run on, and the host port that turns this application's
 * capabilities into the questions the page asks.
 *
 * IT IS ITS OWN FRONTEND FEATURE rather than a second entry under
 * `features/project`, and the split follows the package's own: the settings
 * page is `/settings` and answers `organization:view`, the home is `/[project]`
 * and answers nothing — two addresses, two policies, two host ports. What they
 * share is a workspace graph, and they share it the only way that matters:
 * both ask `organization.getAll` with the same input, which is one cache entry.
 */

import { homeApi } from "@langwatch/project-web/screens/home";
import { uiFeatureApi, type UiFeatureApiBinding } from "../../behavior/ui-feature-transport";
import { homePageLoaders } from "./ui/sections/home-routes";

export const homeApiBinding: UiFeatureApiBinding = uiFeatureApi({
  name: "@langwatch/project-web",
  api: homeApi,
});

export { homePageLoaders };
export { ProjectHomeHostSection } from "./ui/sections/home-host";
