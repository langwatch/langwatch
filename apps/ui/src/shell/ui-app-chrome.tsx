/**
 * The frame every address behind a session is drawn in. The shell resolves
 * this itself and it carries no page key: a key is an address a MODULE
 * answers for, and no module owns the frame drawn around all of them.
 */

import {
  UNAVAILABLE_UI_SCOPE,
  useOptionalUiHostServices,
} from "@langwatch/browser-host/capabilities";
import { UiRouteOutlet } from "@langwatch/browser/route-objects";
import type { ProcessWebConfig } from "@langwatch/config/public-app-config";

import { UiNavigationHost } from "./navigation-host-provider";
import { UiScreenErrorBoundary } from "./ui-error-page";
import type { UiRootHostServices } from "./ui-root-host-services";
import { useAnalyticsIdentity } from "./use-analytics-identity";

export default function UiAppChrome({
  capabilities: root,
  process,
  fullScreen = false,
}: {
  capabilities: UiRootHostServices;
  /** The process owner's slice: the chrome's development badge reads it. */
  process: ProcessWebConfig;
  /** Draws the page with no top bar or sidebar, behind the same gates. */
  fullScreen?: boolean;
}) {
  const capabilities = useOptionalUiHostServices();
  // Mounted outside an application shell, or inside one that declared no
  // scope — a route-table test, never the product, where the composition
  // always supplies both. Nothing has been read, so there is no host to mount
  // and the address draws bare. Scope is checked too because the host READS
  // it, and an unavailable capability throws on read rather than answering.
  if (!capabilities || capabilities.scope === UNAVAILABLE_UI_SCOPE) return <UiRouteOutlet />;

  return (
    <UiNavigationHost commandBar capabilities={root} process={process}>
      <UiAppChromeFrame
        scope={root.scope}
        navigationChrome={root.navigationChrome}
        fullScreen={fullScreen}
        isDevelopment={process.mode === "development"}
      />
    </UiNavigationHost>
  );
}

/** Split so the hooks that read the host run only beneath it. */
function UiAppChromeFrame({
  scope,
  navigationChrome: { NavigationShell, useNavigationTracking },
  fullScreen,
  isDevelopment,
}: Pick<UiRootHostServices, "scope" | "navigationChrome"> & {
  fullScreen: boolean;
  isDevelopment: boolean;
}) {
  useAnalyticsIdentity();
  useNavigationTracking();
  scope.useUiOrgQueryParamSelection();
  return (
    <NavigationShell fullScreen={fullScreen}>
      <UiScreenErrorBoundary isDevelopment={isDevelopment}>
        <UiRouteOutlet />
      </UiScreenErrorBoundary>
    </NavigationShell>
  );
}
