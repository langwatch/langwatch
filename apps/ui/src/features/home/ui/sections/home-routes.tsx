/**
 * Which page key the project home answers: `pages/[project]/index`, no page
 * guard (every section gates its own reads), wrapped in the `return_to`
 * redirect — an address read and a navigation a package may not do itself.
 */

import { projectHomeScreens } from "@langwatch/project-web/screens/home";
import { useEffect, type ComponentType } from "react";

import type { UiPageLoaderRegistry } from "../../../../behavior/ui-page-loaders";
import { useUiCapabilities } from "../../../../behavior/ui-capabilities";
import { uiPage } from "../../../../ui/sections/ui-page";
import { ProjectHomeHostSection } from "./home-host";

/**
 * An internal path, nothing else: a single leading slash, no newline.
 * `//evil.example` is scheme-relative and would leave the deployment.
 */
const SAFE_RETURN_TO = /^\/(?!\/)[^\r\n]*$/;

export function safeReturnToPath(returnTo: string | undefined): string | null {
  if (!returnTo) return null;
  return SAFE_RETURN_TO.test(returnTo) ? returnTo : null;
}

/**
 * Sends the reader where the address asked and draws nothing while it does —
 * rendering the home under a redirect about to fire would flash the wrong page.
 */
function withReturnToRedirect(Screen: ComponentType): ComponentType {
  const Mounted = () => {
    const { route, navigation } = useUiCapabilities();
    const destination = safeReturnToPath(route.reading().query.return_to);

    useEffect(() => {
      if (destination) navigation.replace(destination);
    }, [destination, navigation]);

    if (destination) return null;
    return <Screen />;
  };
  Mounted.displayName = "ProjectHomeWithReturnTo";
  return Mounted;
}

export const homePageLoaders: UiPageLoaderRegistry = {
  "pages/[project]/index": uiPage({
    screen: async () => ({
      default: withReturnToRedirect((await projectHomeScreens.home()).default as ComponentType),
    }),
    host: ProjectHomeHostSection,
  }),
};
