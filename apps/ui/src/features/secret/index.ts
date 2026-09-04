/** Project Secrets settings: single screen in `@langwatch/secret-web`. */

import { secretApi } from "@langwatch/secret-web/screens/secret";
import { uiFeature } from "../../behavior/ui-feature";
import { secretPageLoaders } from "./ui/sections/secret-routes";

export const secretFeature = uiFeature({
  name: "@langwatch/secret-web",
  api: secretApi,
  loaders: secretPageLoaders,
});
