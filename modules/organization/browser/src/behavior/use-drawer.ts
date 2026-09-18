/** Drawer address navigation: opens application overlays without rendering them. */

import { useMemo } from "react";
import { useOrganizationHost } from "../model/organization-host.ts";

export type OrganizationDrawerNavigator = {
  openDrawer: (name: string, props?: Record<string, unknown>) => void;
  closeDrawer: () => void;
};

export function useDrawer(): OrganizationDrawerNavigator {
  const host = useOrganizationHost();
  return useMemo(
    () => ({
      openDrawer: (name, props) => host.openOverlay(name, props),
      closeDrawer: () => host.closeOverlay(),
    }),
    [host],
  );
}
