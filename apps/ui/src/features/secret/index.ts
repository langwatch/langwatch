/** Project Secrets settings: single screen in `@langwatch/secret-web`. */

import { secretApi } from "@langwatch/secret-web/screens/secret";
import { uiFeatureApi, type UiFeatureApiBinding } from "../../behavior/ui-feature-transport";
import { secretPageLoaders } from "./ui/sections/secret-routes";

export const secretApiBinding: UiFeatureApiBinding = uiFeatureApi({
  name: "@langwatch/secret-web",
  api: secretApi,
});

export { secretPageLoaders };
