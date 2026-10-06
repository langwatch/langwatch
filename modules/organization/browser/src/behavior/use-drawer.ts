/** Drawer address navigation: opens application overlays without rendering them. */

import type { UiDrawerToken } from "@langwatch/browser-host/declarations";
import { useMemo } from "react";

import { useOrganizationHost } from "../model/organization-host.ts";

export type OrganizationDrawerNavigator = {
  openDrawer: <Props>(drawer: UiDrawerToken<Props>, props?: Partial<Props>) => void;
  closeDrawer: () => void;
};

export function useDrawer(): OrganizationDrawerNavigator {
  const host = useOrganizationHost();
  return useMemo(
    () => ({
      openDrawer: (drawer, props) => host.openOverlay(drawer, props),
      closeDrawer: () => host.closeOverlay(),
    }),
    [host],
  );
}
