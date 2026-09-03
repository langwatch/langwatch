/** Email Suppressions: single screen in `@langwatch/notification-web`. */

import { notificationApi } from "@langwatch/notification-web/screens/email-suppressions";
import { uiFeatureApi, type UiFeatureApiBinding } from "../../behavior/ui-feature-transport";
import { notificationPageLoaders } from "./ui/sections/notification-routes";

export const notificationApiBinding: UiFeatureApiBinding = uiFeatureApi({
  name: "@langwatch/notification-web",
  api: notificationApi,
});

export { notificationPageLoaders };
