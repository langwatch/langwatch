/**
 * Which page key the Email Suppressions address answers, and what it is wrapped in.
 *
 * ONE KEY, ONE SCREEN, and the same three wrappers in the same order as every
 * other settings family: the host outermost, the harvested settings chrome
 * inside it, and the platform page's own `triggers:view` grant innermost — so a
 * refusal is framed by the settings menu, exactly as
 * `withPermissionGuard({ layoutComponent: SettingsLayout })` framed its own.
 *
 * THE CHROME IS THE POINT OF THIS KEY'S HISTORY. `specs/settings/settings-page-chrome.feature`
 * exists because this page once named the layout only as the guard's
 * `layoutComponent`, which frames the refusal and not the page; the wrapper
 * below frames both.
 */

import { notificationScreens } from "@langwatch/notification-web/screens/email-suppressions";
import type { ComponentType } from "react";

import type { UiPageLoader, UiPageLoaderRegistry } from "../../../../behavior/ui-page-loaders";
import {
  UiPageForbidden,
  UiPageLoading,
  UiPageNotFound,
} from "../../../../ui/elements/ui-page-fallbacks";
import { withUiPageGuard } from "../../../../ui/sections/ui-page-guard";
import { withUiSettingsLayout } from "../../../../ui/sections/ui-settings-layout";
import { EMAIL_SUPPRESSIONS_PAGE_PERMISSION } from "../../behavior/notification-host.adapter";
import { withNotificationHost } from "./notification-host-provider";

const FALLBACKS = {
  loading: UiPageLoading,
  notFound: UiPageNotFound,
  forbidden: UiPageForbidden,
};

const emailSuppressionsPage: UiPageLoader = async () => {
  const module = await notificationScreens.emailSuppressions();
  const guarded = withUiPageGuard({
    permission: EMAIL_SUPPRESSIONS_PAGE_PERMISSION,
    fallbacks: FALLBACKS,
  })(module.default as ComponentType);
  guarded.displayName = "EmailSuppressionsPage";
  return { default: withNotificationHost(withUiSettingsLayout(guarded)) };
};

export const notificationPageLoaders: UiPageLoaderRegistry = {
  "pages/settings/email-suppressions": emailSuppressionsPage,
};
