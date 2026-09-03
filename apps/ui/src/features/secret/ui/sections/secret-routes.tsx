/**
 * Which page key the Secrets address answers, and what it is wrapped in.
 *
 * ONE KEY, ONE SCREEN. The key still reads `pages/settings/secrets`, kept rather
 * than renamed: the route transcript in `apps/ui/tests` is the parity bar for the
 * URL surface and fails the moment a page key changes, so renaming one would
 * spend that guard's signal on a cosmetic edit.
 *
 * Wrapped three times, and the order matters. The host provider is OUTERMOST: a
 * refusal renders the guard's own fallback, which asks nothing of the Secret
 * host, but a page that opens needs the host mounted above it before its first
 * render. Inside that, the SETTINGS CHROME — outside the guard, because
 * `withPermissionGuard({ layoutComponent })` wrapped its own refusal in the
 * layout, so a reader who lacks a grant still sees the settings frame they
 * navigated into. The guard is innermost, around the screen.
 *
 * THE KEY CARRIES NO PAGE-LEVEL GRANT, which is the platform page's policy one
 * for one: it was `SettingsLayout` and nothing else, and read `secrets:manage`
 * inside the page to decide whether the write controls are live. A reader with
 * only `secrets:view` sees the names and no way to change them.
 */

import { secretScreens } from "@langwatch/secret-web/screens/secret";
import type { ComponentType } from "react";
import type { UiPageLoader, UiPageLoaderRegistry } from "../../../../behavior/ui-page-loaders";
import {
  UiPageForbidden,
  UiPageLoading,
  UiPageNotFound,
} from "../../../../ui/elements/ui-page-fallbacks";
import { withUiPageGuard } from "../../../../ui/sections/ui-page-guard";
import { withUiSettingsLayout } from "../../../../ui/sections/ui-settings-layout";
import { withSecretHost } from "./secret-host-provider";

const FALLBACKS = {
  loading: UiPageLoading,
  notFound: UiPageNotFound,
  forbidden: UiPageForbidden,
};

const secretsPage: UiPageLoader = async () => {
  const module = await secretScreens.secrets();
  const guarded = withUiPageGuard({ fallbacks: FALLBACKS })(module.default as ComponentType);
  return { default: withSecretHost(withUiSettingsLayout(guarded)) };
};

export const secretPageLoaders: UiPageLoaderRegistry = {
  "pages/settings/secrets": secretsPage,
};
