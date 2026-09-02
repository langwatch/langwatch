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
 * WHAT IT IS NOT YET: `CurrentDrawer`. The drawer registry names forty-five
 * `platform/app` components by module path, this package does not depend on
 * that application and must not, and the one place a host could hand the
 * registry over — its shell adapter — may not be edited while `platform/app` is
 * deletes-only. The recorded `?drawer.open=` gap therefore stands; see
 * `features/chrome/index.ts`.
 */

import { Box, HStack, Spacer } from "@chakra-ui/react";
import { LogoIcon } from "@langwatch/navigation-web/chrome";
import { Settings } from "lucide-react";
import type { ReactNode } from "react";
import { Link as RouterLink, Outlet, useMatches } from "react-router";
import { isUiInstalledPage } from "../../../installed-ui-page-keys";
import { NavigationHostSection } from "../../../navigation";
import { uiMatchedPageKey } from "../../../../ui/sections/ui-route-objects";
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
    </NavigationHostSection>
  );
}
