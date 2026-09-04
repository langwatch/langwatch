/**
 * The project home: the page key, the `return_to` redirect, the transport
 * and the host port. Its own frontend feature, not a second entry under
 * `features/project` — `/[project]` and `/settings` differ in policy.
 */

import { homeApi } from "@langwatch/project-web/screens/home";
import { uiFeature } from "../../behavior/ui-feature";
import { homePageLoaders } from "./ui/sections/home-routes";

export const homeFeature = uiFeature({
  name: "@langwatch/project-web",
  api: homeApi,
  loaders: homePageLoaders,
});

export { ProjectHomeHostSection } from "./ui/sections/home-host";
