/**
 * Which page keys the Model Provider settings addresses answer, and what they
 * are wrapped in.
 *
 * TWO KEYS, TWO SCREENS. The keys still read `pages/settings/model-providers`
 * and `pages/settings/model-costs`, and they are kept rather than renamed: the
 * route transcript in `apps/ui/tests` is the parity bar for the URL surface and
 * fails the moment a page key changes, so renaming one would spend that guard's
 * signal on a cosmetic edit.
 *
 * Each page is wrapped THREE times, and the order matters. The host provider is
 * OUTERMOST: a refusal renders the guard's own fallback, which asks nothing of
 * the Model Provider host, but a page that opens needs the host mounted above it
 * before its first render. Inside that, the SETTINGS CHROME — outside the guard,
 * because `withPermissionGuard({ layoutComponent })` wrapped its own refusal in
 * the layout, so a reader who lacks a grant still sees the settings frame they
 * navigated into. The guard is innermost, around the screen.
 *
 * NEITHER KEY CARRIES A PAGE-LEVEL GRANT, and that is the platform pages'
 * policy one for one: both were `SettingsLayout` and nothing else, and both read
 * `hasPermission("project:manage")` INSIDE the page to decide whether the write
 * controls are live. A reader who cannot manage providers can still see which
 * ones exist, which is what a project-scoped member needs in order to know why a
 * model is missing. Inventing a guard here would refuse them the page.
 *
 * The wrapping happens once per lazy load rather than once per render: React
 * Router caches what a `lazy` resolves to, so the component identity below is
 * stable for the life of the route.
 */

import { modelProviderScreens } from "@langwatch/model-provider-web/screens/model-provider";
import type { ComponentType } from "react";
import type { UiPageLoader, UiPageLoaderRegistry } from "../../../../behavior/ui-page-loaders";
import {
  UiPageForbidden,
  UiPageLoading,
  UiPageNotFound,
} from "../../../../ui/elements/ui-page-fallbacks";
import { withUiPageGuard } from "../../../../ui/sections/ui-page-guard";
import { withUiSettingsLayout } from "../../../../ui/sections/ui-settings-layout";
import { withModelProviderHost } from "./model-provider-host-provider";

const FALLBACKS = {
  loading: UiPageLoading,
  notFound: UiPageNotFound,
  forbidden: UiPageForbidden,
};

const modelProvidersPage: UiPageLoader = async () => {
  const module = await modelProviderScreens.modelProviders();
  const guarded = withUiPageGuard({ fallbacks: FALLBACKS })(module.default as ComponentType);
  return { default: withModelProviderHost(withUiSettingsLayout(guarded)) };
};

const modelCostsPage: UiPageLoader = async () => {
  const module = await modelProviderScreens.modelCosts();
  const guarded = withUiPageGuard({ fallbacks: FALLBACKS })(module.default as ComponentType);
  return { default: withModelProviderHost(withUiSettingsLayout(guarded)) };
};

export const modelProviderPageLoaders: UiPageLoaderRegistry = {
  "pages/settings/model-providers": modelProvidersPage,
  "pages/settings/model-costs": modelCostsPage,
};
