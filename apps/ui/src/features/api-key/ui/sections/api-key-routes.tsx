/**
 * Which page keys the API Key addresses answer. Neither carries a
 * page-level grant: `/settings/api-keys` decides per-row; `/cli/auth` does
 * its own SSO redirect, which a guard would break by refusing it first.
 */

import { apiKeyScreens } from "@langwatch/api-key-web/screens/api-key";
import { useEffect, type ComponentType } from "react";
import { useUiCapabilities } from "../../../../behavior/ui-capabilities";
import type { UiPageLoaderRegistry } from "../../../../behavior/ui-page-loaders";
import { uiPage } from "../../../../ui/sections/ui-page";
import { ApiKeyHost } from "./api-key-host";

/** What `/cli/auth` calls itself in the browser tab. */
export const CLI_AUTH_DOCUMENT_TITLE = "Authorize CLI · LangWatch";

/** The browser tab's title: a screen may not reach the document, so this writes it via the capability and restores the previous one on unmount. */
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
