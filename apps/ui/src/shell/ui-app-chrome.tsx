/**
 * The frame every address behind a session is drawn in. The shell resolves
 * this itself and it carries no page key: a key is an address a MODULE
 * answers for, and no module owns the frame drawn around all of them.
 */

import { useOptionalUiCapabilities } from "@langwatch/browser-host/capabilities";
import { NavigationShell, useNavigationTracking } from "@langwatch/navigation-browser/chrome";
import { useUiOrgQueryParamSelection } from "@langwatch/organization-browser/surfaces/scope-capability";

import { UiNavigationHost } from "./navigation-host-provider";
import { UiRouteOutlet } from "./ui-route-objects";

export default function UiAppChrome() {
  const capabilities = useOptionalUiCapabilities();
  // Mounted outside an application shell — a route-table test, never the
  // product, where `createUiFeatureShell` always answers. Nothing has been
  // read, so there is no host to mount and the address draws bare.
  if (!capabilities) return <UiRouteOutlet />;

  return (
    <UiNavigationHost commandBar>
      <UiAppChromeFrame />
    </UiNavigationHost>
  );
}

/** Split so the hooks that read the host run only beneath it. */
function UiAppChromeFrame() {
  useNavigationTracking();
  useUiOrgQueryParamSelection();
  return (
    <NavigationShell>
      <UiRouteOutlet />
    </NavigationShell>
  );
}
