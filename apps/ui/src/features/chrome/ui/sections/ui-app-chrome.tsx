/**
 * The chrome route, above the two project-scoped route groups: draws the
 * shell only over pages served here, but mounts `CurrentDrawer` and the
 * trace drawer unconditionally — a drawer must open over a legacy page too.
 */

import { NavigationShell, useNavigationTracking } from "@langwatch/navigation-web/chrome";
import { CurrentDrawer } from "@langwatch/ui-drawer";
import { installedUiDrawers } from "../../../installed-ui-features";
import { NavigationHostSection } from "../../../navigation";
import { UiTraceDrawerMount } from "../../../traces";
import { useUiOrgQueryParamSelection } from "../../../../behavior/ui-scope-org-param";
import { UiRouteOutlet, useUiMatchedPageKey } from "../../../../ui/sections/ui-route-objects";

export default function UiAppChrome() {
  return (
    <NavigationHostSection commandBar>
      <UiAppChromeBody />
      <CurrentDrawer drawers={installedUiDrawers} />
      <UiTraceDrawerMount />
    </NavigationHostSection>
  );
}

/**
 * Everything that must be inside the host: `useNavigationTracking` keeps the product memory and Settings-entry
 * page current, which the sidebar's "Back to {product}" entry reads, and the `?org=` switch runs here because
 * every org-scoped page (`/me`, `/settings/*`, `/gateway/*`) is served under this route.
 */
function UiAppChromeBody() {
  useNavigationTracking();
  useUiOrgQueryParamSelection();
  const page = useUiMatchedPageKey();
  const servedHere = page !== void 0;

  if (!servedHere) return <UiRouteOutlet />;

  return (
    <NavigationShell>
      <UiRouteOutlet />
    </NavigationShell>
  );
}
