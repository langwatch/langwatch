/** Integrations: screen, installation row and install address, all in `@langwatch/github-web`. */

import { githubApi } from "@langwatch/github-web/screens/integrations";
import { uiFeatureApi, type UiFeatureApiBinding } from "../../behavior/ui-feature-transport";
import { githubPageLoaders } from "./ui/sections/github-routes";

export const githubApiBinding: UiFeatureApiBinding = uiFeatureApi({
  name: "@langwatch/github-web",
  api: githubApi,
});

export { githubPageLoaders };
