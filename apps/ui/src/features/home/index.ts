/**
 * The project home: the page key, the `return_to` redirect, the transport
 * and the host port. Its own frontend feature, not a second entry under
 * `features/project` — `/[project]` and `/settings` differ in policy.
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
