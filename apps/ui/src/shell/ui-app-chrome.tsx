/**
 * The frame every address behind a session is drawn in. The shell resolves
 * this itself and it carries no page key: a key is an address a MODULE
 * answers for, and no module owns the frame drawn around all of them.
 */

import {
  NavigationShell,
  useNavigationTracking,
  useOptionalNavigationHost,
} from "@langwatch/navigation-browser/chrome";

import { UiRouteOutlet } from "./ui-route-objects";

export default function UiAppChrome() {
  const host = useOptionalNavigationHost();
  if (!host) return <UiRouteOutlet />;
  return <UiAppChromeFrame />;
}

/** Split so the tracking hook runs only where a host answers it. */
function UiAppChromeFrame() {
  useNavigationTracking();
  return (
    <NavigationShell>
      <UiRouteOutlet />
    </NavigationShell>
  );
}
