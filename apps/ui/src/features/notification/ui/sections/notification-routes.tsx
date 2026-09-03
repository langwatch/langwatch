/**
 * Which page key the Email Suppressions address answers, and what it is wrapped in.
 *
 * ONE KEY, ONE SCREEN.
 *
 * THE CHROME IS THE POINT OF THIS KEY'S HISTORY. `specs/settings/settings-page-chrome.feature`
 * exists because this page once named the layout only as the guard's
 * `layoutComponent`, which frames the refusal and not the page; `uiPage`'s
 * settings layout frames both.
 */

import { notificationScreens } from "@langwatch/notification-web/screens/email-suppressions";
import type { ComponentType } from "react";

import type { UiPageLoaderRegistry } from "../../../../behavior/ui-page-loaders";
import { uiPage } from "../../../../ui/sections/ui-page";
import { NotificationHost } from "./notification-host";

const EMAIL_SUPPRESSIONS_PAGE_PERMISSION = "triggers:view";

export const notificationPageLoaders: UiPageLoaderRegistry = {
  "pages/settings/email-suppressions": uiPage({
    screen: async () => ({
      default: (await notificationScreens.emailSuppressions()).default as ComponentType,
    }),
    host: NotificationHost,
    settingsLayout: true,
    permission: EMAIL_SUPPRESSIONS_PAGE_PERMISSION,
  }),
};
