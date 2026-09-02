/**
 * The Email Suppressions family, as this application composes it.
 *
 * The screen lives in `@langwatch/notification-web`; what belongs to the
 * application is everything it is not allowed to own — the page key, the
 * permission policy, the settings chrome, the transport, and the host port that
 * turns this application's capabilities into the questions the screen asks.
 */

import { notificationApi } from "@langwatch/notification-web/screens/email-suppressions";
import { uiFeatureApi, type UiFeatureApiBinding } from "../../behavior/ui-feature-transport";
import { notificationPageLoaders } from "./ui/sections/notification-routes";

export const notificationApiBinding: UiFeatureApiBinding = uiFeatureApi({
  name: "@langwatch/notification-web",
  api: notificationApi,
});

export { notificationPageLoaders };
