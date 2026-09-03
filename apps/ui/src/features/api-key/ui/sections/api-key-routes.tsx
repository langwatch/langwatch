/**
 * Which page keys the API Key addresses answer, and what they are wrapped in.
 *
 * TWO KEYS, TWO SCREENS, TWO DIFFERENT FRAMES — which is what makes this family
 * unlike the four settings families before it.
 *
 *   `pages/settings/api-keys` is a settings page. Wrapped THREE times, and the
 *   order matters: the host provider is OUTERMOST, because a refusal renders the
 *   guard's own fallback (which asks nothing of the API Key host) but a page that
 *   opens needs the host mounted above it before its first render. Inside that,
 *   the SETTINGS CHROME — outside the guard, because
 *   `withPermissionGuard({ layoutComponent })` wrapped its own refusal in the
 *   layout, so a reader who lacks a grant still sees the settings frame they
 *   navigated into. The guard is innermost, around the screen.
 *
 *   `pages/cli/auth` is NOT a settings page and never was. It is where a browser
 *   opened by `langwatch login` lands, with no product shell around it: the
 *   platform page rendered `OnboardingContainer` and the screen carries its own
 *   narrowed copy of that frame. So it gets the host, the guard and a document
 *   title, and no settings chrome at all.
 *
 * NEITHER KEY CARRIES A PAGE-LEVEL GRANT OR A FLAG, and that is the platform
 * pages' policy one for one. `/settings/api-keys` was `SettingsLayout` and
 * nothing else, deciding what a reader may DO from `apiKey.orgMembers` answering
 * non-empty and from `project:manage`; a member who can see their own keys keeps
 * seeing them. `/cli/auth` had no guard either — it does its own session
 * redirect, preserving the device code through SSO, which a permission guard
 * would break by refusing before the redirect could run. Inventing a grant for
 * either would refuse readers the product admits today, which is the mistake the
 * datasets family's detail page warned about.
 *
 * The wrapping happens once per lazy load rather than once per render: React
 * Router caches what a `lazy` resolves to, so the component identity below is
 * stable for the life of the route.
 */

import { apiKeyScreens } from "@langwatch/api-key-web/screens/api-key";
import { useEffect, type ComponentType } from "react";
import { useUiCapabilities } from "../../../../behavior/ui-capabilities";
import type { UiPageLoader, UiPageLoaderRegistry } from "../../../../behavior/ui-page-loaders";
import {
  UiPageForbidden,
  UiPageLoading,
  UiPageNotFound,
} from "../../../../ui/elements/ui-page-fallbacks";
import { withUiPageGuard } from "../../../../ui/sections/ui-page-guard";
import { withUiSettingsLayout } from "../../../../ui/sections/ui-settings-layout";
import { withApiKeyHost } from "./api-key-host-provider";

const FALLBACKS = {
  loading: UiPageLoading,
  notFound: UiPageNotFound,
  forbidden: UiPageForbidden,
};

/** What `/cli/auth` calls itself in the browser tab. */
export const CLI_AUTH_DOCUMENT_TITLE = "Authorize CLI · LangWatch";

/**
 * The browser tab's title, set by the page that owns it.
 *
 * `platform/app` set it with a `<Head><title>` inside the page body, which is
 * the application's compatibility shim for a framework this application does not
 * run. A screen may not reach the document, so the title travels as data and the
 * document-title capability writes it — and puts the previous one back when the
 * page unmounts, which is what keeps a title from outliving its page. The
 * personal-workspace family's shape, second use.
 */
function withDocumentTitle<P extends object>(
  title: string,
  Page: ComponentType<P>,
): ComponentType<P> {
  const Titled = (props: P) => {
    const { documentTitle } = useUiCapabilities();
    useEffect(() => documentTitle.set(title), [documentTitle]);
    return <Page {...props} />;
  };
  Titled.displayName = `withDocumentTitle(${Page.displayName ?? Page.name ?? "Page"})`;
  return Titled;
}

const apiKeysPage: UiPageLoader = async () => {
  const module = await apiKeyScreens.apiKeys();
  const guarded = withUiPageGuard({ fallbacks: FALLBACKS })(module.default as ComponentType);
  return { default: withApiKeyHost(withUiSettingsLayout(guarded)) };
};

const cliAuthPage: UiPageLoader = async () => {
  const module = await apiKeyScreens.cliAuth();
  const guarded = withUiPageGuard({ fallbacks: FALLBACKS })(module.default as ComponentType);
  return { default: withApiKeyHost(withDocumentTitle(CLI_AUTH_DOCUMENT_TITLE, guarded)) };
};

export const apiKeyPageLoaders: UiPageLoaderRegistry = {
  "pages/settings/api-keys": apiKeysPage,
  "pages/cli/auth": cliAuthPage,
};
