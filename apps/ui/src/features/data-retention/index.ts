/** Data Retention: screen, drawer and two confirm dialogs, all in `@langwatch/data-retention-web`. */

import { dataRetentionApi } from "@langwatch/data-retention-web/screens/data-retention";
import { uiFeatureApi, type UiFeatureApiBinding } from "../../behavior/ui-feature-transport";
import { dataRetentionPageLoaders } from "./ui/sections/data-retention-routes";

export const dataRetentionApiBinding: UiFeatureApiBinding = uiFeatureApi({
  name: "@langwatch/data-retention-web",
  api: dataRetentionApi,
});

export { dataRetentionPageLoaders };
