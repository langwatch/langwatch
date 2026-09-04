/** Data Retention: screen, drawer and two confirm dialogs, all in `@langwatch/data-retention-web`. */

import { dataRetentionApi } from "@langwatch/data-retention-web/screens/data-retention";
import { uiFeature } from "../../behavior/ui-feature";
import { dataRetentionPageLoaders } from "./ui/sections/data-retention-routes";

export const dataRetentionFeature = uiFeature({
  name: "@langwatch/data-retention-web",
  api: dataRetentionApi,
  loaders: dataRetentionPageLoaders,
});
