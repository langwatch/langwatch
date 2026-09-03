/**
 * Which page key the project home answers, and what it is wrapped in.
 *
 * ONE KEY, ONE SCREEN: `pages/[project]/index`, the address a reader lands on
 * after signing in. The key reads as it always did, kept rather than renamed —
 * the route transcript in `apps/ui/tests` is the parity bar for the URL surface
 * and fails the moment a page key changes, so renaming one would spend that
 * guard's signal on a cosmetic edit.
 *
 * NO PAGE GUARD, and the platform page had none: reaching a project at all is
 * what the scope resolution already decided, and every section of the home
 * gates its own reads. A grant in front of this page would refuse a member the
 * one address that tells them where they are.
 *
 * THE `return_to` REDIRECT TRAVELS WITH THE KEY. The platform page wrapped the
 * home in it, and it belongs to the composing application rather than to the
 * screen: it is a reading of the address bar and a navigation, which is exactly
 * what a package may not do for itself. The safety rule is the one it always
 * had — a single leading slash, no newlines — so a `return_to` naming another
 * origin sends nobody anywhere.
 */

import { projectHomeScreens } from "@langwatch/project-web/screens/home";
import { useEffect, type ComponentType } from "react";

import type { UiPageLoader, UiPageLoaderRegistry } from "../../../../behavior/ui-page-loaders";
import { useUiCapabilities } from "../../../../behavior/ui-capabilities";
import { withProjectHomeHost } from "./home-host-provider";

/**
 * An internal path, and nothing else.
 *
 * A single leading slash with no newline in it. `//evil.example` is
 * scheme-relative and would leave the deployment; a newline splits the value
 * into something a header or a log line reads as two.
 */
const SAFE_RETURN_TO = /^\/(?!\/)[^\r\n]*$/;

export function safeReturnToPath(returnTo: string | undefined): string | null {
  if (!returnTo) return null;
  return SAFE_RETURN_TO.test(returnTo) ? returnTo : null;
}

/**
 * Sends the reader on where the address asked, and draws nothing while it does.
 *
 * Rendering the home under a redirect that is about to fire would paint a page
 * the reader never asked for and then replace it, which reads as a flash of the
 * wrong thing rather than as a redirect.
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

const projectHomePage: UiPageLoader = async () => {
  const module = await projectHomeScreens.home();
  return { default: withProjectHomeHost(withReturnToRedirect(module.default)) };
};

export const homePageLoaders: UiPageLoaderRegistry = {
  "pages/[project]/index": projectHomePage,
};
