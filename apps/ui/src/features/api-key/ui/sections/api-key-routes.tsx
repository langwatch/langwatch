/**
 * Which page keys the API Key addresses answer, and what they are wrapped in.
 *
 * TWO KEYS, TWO SCREENS, TWO DIFFERENT FRAMES. `pages/settings/api-keys` gets
 * the host, the settings chrome and the guard, in that order. `pages/cli/auth`
 * is where a browser opened by `langwatch login` lands, with no product shell
 * around it — the screen carries its own narrowed copy of that frame — so it
 * gets the host, a document title and the guard, and no settings chrome.
 *
 * NEITHER KEY CARRIES A PAGE-LEVEL GRANT OR A FLAG. `/settings/api-keys` was
 * `SettingsLayout` and nothing else, deciding what a reader may DO from
 * `apiKey.orgMembers` answering non-empty and from `project:manage`; a member
 * who can see their own keys keeps seeing them. `/cli/auth` had no guard
 * either — it does its own session redirect, preserving the device code
 * through SSO, which a permission guard would break by refusing before the
 * redirect could run.
 */

import { apiKeyScreens } from "@langwatch/api-key-web/screens/api-key";
import { useEffect, type ComponentType } from "react";
import { useUiCapabilities } from "../../../../behavior/ui-capabilities";
import type { UiPageLoaderRegistry } from "../../../../behavior/ui-page-loaders";
import { uiPage } from "../../../../ui/sections/ui-page";
import { ApiKeyHost } from "./api-key-host";

/** What `/cli/auth` calls itself in the browser tab. */
export const CLI_AUTH_DOCUMENT_TITLE = "Authorize CLI · LangWatch";

/**
 * The browser tab's title, set by the page that owns it.
 *
 * A screen may not reach the document, so the title travels as data and the
 * document-title capability writes it — and puts the previous one back when the
 * page unmounts, which is what keeps a title from outliving its page.
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

export const apiKeyPageLoaders: UiPageLoaderRegistry = {
  "pages/settings/api-keys": uiPage({
    screen: async () => ({ default: (await apiKeyScreens.apiKeys()).default as ComponentType }),
    host: ApiKeyHost,
    settingsLayout: true,
  }),
  "pages/cli/auth": uiPage({
    screen: async () => ({
      default: withDocumentTitle(
        CLI_AUTH_DOCUMENT_TITLE,
        (await apiKeyScreens.cliAuth()).default as ComponentType,
      ),
    }),
    host: ApiKeyHost,
  }),
};
