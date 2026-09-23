/**
 * Addresses the table names that no installed module answers for yet. The
 * router resolves every descriptor when it is BUILT, so one unregistered key
 * takes the whole browser down; these keep the gap at its own address.
 */

import type { UiPageLoaderRegistry } from "@langwatch/ui-kernel/feature-install";
import { UiRouteOutlet } from "@langwatch/ui-kernel/route-objects";

export function UiUnservedPage() {
  return (
    <output style={{ display: "block", padding: "3rem", textAlign: "center" }}>
      <h1 style={{ fontSize: "1.25rem", marginBottom: "0.5rem" }}>
        This page is not available yet
      </h1>
      <p style={{ opacity: 0.7 }}>Nothing on this build serves this address.</p>
    </output>
  );
}

/** A layout no module has re-homed draws its children, unframed but present. */
const unservedLayout = async () => ({ default: UiRouteOutlet });
const unservedPage = async () => ({ default: UiUnservedPage });

/**
 * The list only ever shrinks: a module declaring one of these keys makes its
 * entry here dead, which `every-route-page-is-declared` fails on.
 */
export const uiUnservedPageLoaders: UiPageLoaderRegistry = {
  "layouts/project-langy": unservedLayout,
  "pages/[project]/automations/activity": unservedPage,
  "pages/[project]/evaluations/[id]/edit/choose": unservedPage,
  "pages/[project]/analytics/custom/index": unservedPage,
};
