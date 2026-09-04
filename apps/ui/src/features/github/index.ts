/** Integrations: screen, installation row and install address, all in `@langwatch/github-web`. */

import { githubApi } from "@langwatch/github-web/screens/integrations";
import { uiFeature } from "../../behavior/ui-feature";
import { githubPageLoaders } from "./ui/sections/github-routes";

export const githubFeature = uiFeature({
  name: "@langwatch/github-web",
  api: githubApi,
  loaders: githubPageLoaders,
});
