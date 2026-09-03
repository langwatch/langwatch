/** Which page key the Email Suppressions address answers: `uiPage`'s settings layout frames both the page and a refusal, unlike the old `layoutComponent` guard. */

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
