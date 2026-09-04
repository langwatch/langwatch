/** Email Suppressions: single screen in `@langwatch/notification-web`. */

import { notificationApi } from "@langwatch/notification-web/screens/email-suppressions";
import { uiFeature } from "../../behavior/ui-feature";
import { notificationPageLoaders } from "./ui/sections/notification-routes";

export const notificationFeature = uiFeature({
  name: "@langwatch/notification-web",
  api: notificationApi,
  loaders: notificationPageLoaders,
});
