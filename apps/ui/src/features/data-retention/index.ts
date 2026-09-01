/**
 * The Data Retention family, as this application composes it.
 *
 * The screen, its drawer and its two confirm dialogs live in
 * `@langwatch/data-retention-web`; what belongs to the application is
 * everything they are not allowed to own — which page key the address answers,
 * the permission policy in front of it, the settings chrome around it, the
 * transport its hooks run on, and the host port that turns this application's
 * capabilities into the questions the family asks.
 */

import { dataRetentionApi } from "@langwatch/data-retention-web/screens/data-retention";
import { uiFeatureApi, type UiFeatureApiBinding } from "../../behavior/ui-feature-transport";
import { dataRetentionPageLoaders } from "./ui/sections/data-retention-routes";

export const dataRetentionApiBinding: UiFeatureApiBinding = uiFeatureApi({
  name: "@langwatch/data-retention-web",
  api: dataRetentionApi,
});

export { dataRetentionPageLoaders };
