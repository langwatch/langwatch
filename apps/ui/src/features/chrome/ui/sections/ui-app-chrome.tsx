/**
 * The chrome route: what this application draws around a page it serves itself.
 *
 * A LAYOUT ROUTE, not a wrapper a screen opts into. It sits above the two
 * project-scoped groups of the route table, so everything behind a session
 * renders inside it and a screen that moved out of `platform/app` gets the
 * header without knowing it exists — which is the whole point, since a screen
 * in a feature package may not import this application at all.
 *
 * IT MOUNTS THE NAVIGATION HOST ONCE, above the swapping page. That is what
 * lets `projectSwitcher()` be a real answer instead of the `null` the
 * organization and secret families had to record: the control needs a workspace
 * graph, and one host above the outlet is one graph for every screen below it.
 *
 * WHY IT ASKS WHICH HALF SERVES THE PAGE. A page `platform/app` still serves
 * renders its own `DashboardLayout`, header and all. Drawing this header above
 * that one would give those pages two. So the chrome is drawn over the pages
 * whose loader is registered HERE, and a legacy page gets the bare outlet it
 * gets today. The question disappears with the last legacy loader, and so does
 * the branch.
 *
 * IT MOUNTS `CurrentDrawer`, AND THAT CLOSES THE GAP EIGHTEEN MANIFESTS
 * RECORDED. Every moved family wrote the same line: a screen asks its host to
 * open a drawer, the host writes `?drawer.open=<name>`, and nothing opened —
 * because the mount lived in `platform/app`'s `DashboardLayout` and the
 * registry it read named forty-five modules of that application. The registry
 * is composed now (`installed-ui-drawers.ts`) and the mount is here, once,
 * above the outlet, which is the only place a drawer opened from any page can
 * render.
 *
 * OUTSIDE THE HEADER BRANCH ON PURPOSE. The header is drawn only over pages
 * this application serves, because a legacy page brings its own. A DRAWER is
 * not chrome in that sense: it is addressed by the query string, it renders
 * through a portal, and a reader who follows `?drawer.open=…` onto a legacy
 * page is asking for the same drawer. So the mount is unconditional and the
 * header stays conditional.
 */

import { Box, HStack, Spacer } from "@chakra-ui/react";
import { LogoIcon } from "@langwatch/navigation-web/chrome";
import { CurrentDrawer } from "@langwatch/ui-drawer";
import { Settings } from "lucide-react";
import type { ReactNode } from "react";
import { Link as RouterLink, Outlet, useMatches } from "react-router";
import { installedUiDrawers } from "../../../installed-ui-drawers";
import { isUiInstalledPage } from "../../../installed-ui-page-keys";
import { NavigationHostSection } from "../../../navigation";
import { uiMatchedPageKey } from "../../../../ui/sections/ui-route-objects";
import { UiProductSwitcher } from "../blocks/ui-product-switcher";
import { UiProjectSwitcher } from "../blocks/ui-project-switcher";

/** The bar's height. */
const UI_APP_CHROME_HEIGHT = 48;

function UiAppChromeBar() {
  return (
    <HStack
      as="header"
      height={`${UI_APP_CHROME_HEIGHT}px`}
      flexShrink={0}
      width="full"
      paddingX={3}
      gap={2}
      borderBottomWidth="1px"
      borderColor="border"
      background="bg.panel"
    >
      <RouterLink to="/" aria-label="LangWatch home">
        <Box display="flex" alignItems="center" paddingX={1}>
          <LogoIcon width={16} height={22} />
        </Box>
      </RouterLink>
      <UiProductSwitcher />
      <UiProjectSwitcher />
      <Spacer />
      <RouterLink to="/settings" aria-label="Settings">
        <Box display="flex" alignItems="center" color="fg.muted" padding={2}>
          <Settings size={16} />
        </Box>
      </RouterLink>
    </HStack>
  );
}

function UiAppChromeFrame({ children }: { children: ReactNode }) {
  return (
    <Box display="flex" flexDirection="column" width="full" height="full" minHeight="100vh">
      <UiAppChromeBar />
      <Box flex={1} minHeight={0} width="full">
        {children}
      </Box>
    </Box>
  );
}

export default function UiAppChrome() {
  const matches = useMatches();
  const page = uiMatchedPageKey(matches);
  const servedHere = page !== void 0 && isUiInstalledPage(page);

  return (
    <NavigationHostSection>
      {servedHere ? (
        <UiAppChromeFrame>
          <Outlet />
        </UiAppChromeFrame>
      ) : (
        <Outlet />
      )}
      <CurrentDrawer drawers={installedUiDrawers} />
    </NavigationHostSection>
  );
}
