/**
 * The frame every address behind a session is drawn in. The shell resolves
 * this itself and it carries no page key: a key is an address a MODULE
 * answers for, and no module owns the frame drawn around all of them.
 */

import {
  UNAVAILABLE_UI_SCOPE,
  useOptionalUiCapabilities,
} from "@langwatch/browser-host/capabilities";
import { NavigationShell, useNavigationTracking } from "@langwatch/navigation-browser/chrome";
import { useUiOrgQueryParamSelection } from "@langwatch/organization-browser/surfaces/scope-capability";
import { UiRouteOutlet } from "@langwatch/ui-kernel/route-objects";

import { UiNavigationHost } from "./navigation-host-provider";
import { useAnalyticsIdentity } from "./use-analytics-identity";

export default function UiAppChrome() {
  const capabilities = useOptionalUiCapabilities();
  // Mounted outside an application shell, or inside one that declared no
  // scope — a route-table test, never the product, where the composition
  // always supplies both. Nothing has been read, so there is no host to mount
  // and the address draws bare. Scope is checked too because the host READS
  // it, and an unavailable capability throws on read rather than answering.
  if (!capabilities || capabilities.scope === UNAVAILABLE_UI_SCOPE) return <UiRouteOutlet />;

  return (
    <UiNavigationHost commandBar>
      <UiAppChromeFrame />
    </UiNavigationHost>
  );
}

/** Split so the hooks that read the host run only beneath it. */
function UiAppChromeFrame() {
  useAnalyticsIdentity();
  useNavigationTracking();
  useUiOrgQueryParamSelection();
  return (
    <NavigationShell>
      <UiRouteOutlet />
    </NavigationShell>
  );
}
