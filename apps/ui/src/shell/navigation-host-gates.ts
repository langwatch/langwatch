/**
 * What the chrome OFFERS, as opposed to what it draws. Each gate names one
 * surface: absent is a real answer, so a reader who may not start a Langy
 * turn sees no entry rather than one that refuses when pressed.
 */

import { isLangyDemoProject } from "@langwatch/langy-browser/surfaces/langy-demo-project";
import type { NavigationOpsAccess } from "@langwatch/navigation-browser/navigation";

/**
 * `langy:create`, not `langy:view`: the palette hand-off queues an auto-send,
 * so offering it on the read grant would invite a 403.
 */
const LANGY_CREATE_PERMISSION = "langy:create";
const LANGY_RELEASE_FLAG = "release_langy_enabled";

/** Presence is broadcast from the Trace Explorer and nowhere else. */
const TRACES_ROUTE_PATTERN = "/:project/traces";

const OPS_VIEW_PERMISSION = "ops:view";
const OPS_MANAGE_PERMISSION = "ops:manage";

export function offersLangyAsk({
  hasPermission,
  isFeatureEnabled,
  projectSlug,
  demoProjectSlug,
}: {
  hasPermission: (permission: string) => boolean;
  isFeatureEnabled: (flag: string) => boolean;
  projectSlug: string | undefined;
  demoProjectSlug: string | undefined;
}): boolean {
  if (!hasPermission(LANGY_CREATE_PERMISSION)) return false;
  if (!isFeatureEnabled(LANGY_RELEASE_FLAG)) return false;
  return !isLangyDemoProject({ projectSlug, demoProjectSlug });
}

export function offersPresenceMenuItem(routePattern: string): boolean {
  return (
    routePattern === TRACES_ROUTE_PATTERN || routePattern.startsWith(`${TRACES_ROUTE_PATTERN}/`)
  );
}

/** How far into the internal operations pages the reader reaches. */
export function opsAccessOf(hasPermission: (permission: string) => boolean): NavigationOpsAccess {
  return {
    hasAccess: hasPermission(OPS_VIEW_PERMISSION),
    isAdmin: hasPermission(OPS_MANAGE_PERMISSION),
  };
}
