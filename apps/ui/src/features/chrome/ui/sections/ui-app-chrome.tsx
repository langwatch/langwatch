/**
 * The chrome route: what this application draws around a page it serves itself.
 *
 * A LAYOUT ROUTE, not a wrapper a screen opts into. It sits above the two
 * project-scoped groups of the route table, so everything behind a session
 * renders inside it and a screen that moved out of `platform/app` gets the
 * chrome without knowing it exists — which is the whole point, since a screen
 * in a feature package may not import this application at all.
 *
 * IT MOUNTS THE NAVIGATION HOST ONCE, above the swapping page. That is what
 * lets the sidebar, the two switchers and the screen below them read ONE
 * workspace graph. One host above the outlet is one graph for every surface.
 *
 * IT DRAWS THE WHOLE SHELL NOW, not a header strip. `@langwatch/navigation-web`
 * carries the application shell — the top bar with the product and project
 * switchers, the product sidebar, the settings menu, the content card and the
 * page body inside it — moved whole out of `platform/app`'s `DashboardLayout`
 * and its navigation-v2 shell. What is left here is the composition: which page
 * keys this half serves, and the drawer mount.
 *
 * WHY IT STILL ASKS WHICH HALF SERVES THE PAGE. A page `platform/app` still
 * serves renders its own `DashboardLayout`, sidebar and all. Drawing this shell
 * above that one would give those addresses two of everything. So the shell is
 * drawn over the pages whose loader is registered HERE, and a legacy page gets
 * the bare outlet it gets today. The question disappears with the last legacy
 * loader, and so does the branch.
 *
 * IT MOUNTS `CurrentDrawer`, AND THAT CLOSES THE GAP EIGHTEEN MANIFESTS
 * RECORDED. Every moved family wrote the same line: a screen asks its host to
 * open a drawer, the host writes `?drawer.open=<name>`, and nothing opened —
 * because the mount lived in `platform/app`'s `DashboardLayout` and the
 * registry it read named modules of that application. The registry is composed
 * now (`installed-ui-drawers.ts`) and the mount is here, once, above the
 * outlet, which is the only place a drawer opened from any page can render.
 *
 * IT CARRIES THE SEARCH PALETTE, which is what lit the shell's Quick Search
 * row and the header's trigger. `commandBar` on the host section is what mounts
 * it, and it is asked for HERE and nowhere else: the palette is one document's
 * one Cmd+K, and the three addresses outside this layout mount their own host
 * without one rather than risk two dialogs where the two nest.
 *
 * OUTSIDE THE SHELL BRANCH ON PURPOSE. The shell is drawn only over pages this
 * application serves, because a legacy page brings its own. A DRAWER is not
 * chrome in that sense: it is addressed by the query string, it renders through
 * a portal, and a reader who follows `?drawer.open=…` onto a legacy page is
 * asking for the same drawer. So the mount is unconditional and the shell stays
 * conditional.
 */

import { NavigationShell, useNavigationTracking } from "@langwatch/navigation-web/chrome";
import { CurrentDrawer } from "@langwatch/ui-drawer";
import { Outlet, useMatches } from "react-router";
import { installedUiDrawers } from "../../../installed-ui-drawers";
import { isUiInstalledPage } from "../../../installed-ui-page-keys";
import { NavigationHostSection } from "../../../navigation";
import { uiMatchedPageKey } from "../../../../ui/sections/ui-route-objects";

export default function UiAppChrome() {
  return (
    <NavigationHostSection commandBar>
      <UiAppChromeBody />
      <CurrentDrawer drawers={installedUiDrawers} />
    </NavigationHostSection>
  );
}

/**
 * Everything that has to be INSIDE the host, which is the two write points as
 * much as the shell.
 *
 * `useNavigationTracking` keeps the per-organization product memory current and
 * captures the page a reader left when they enter Settings. Both are what the
 * sidebar's own "Back to {product}" entry reads, so a chrome that draws that
 * entry without mounting this offers a way back that never learns where back
 * is. It sits here rather than in the layout above because it asks the host,
 * and the host is mounted by the layout above.
 */
function UiAppChromeBody() {
  useNavigationTracking();
  const matches = useMatches();
  const page = uiMatchedPageKey(matches);
  const servedHere = page !== void 0 && isUiInstalledPage(page);

  if (!servedHere) return <Outlet />;

  return (
    <NavigationShell>
      <Outlet />
    </NavigationShell>
  );
}
