/** Drawer address navigation: opens application overlays without rendering them. */

import type {
  DrawerPropsMapOf,
  UiDrawerMap,
  UiDrawerPropsOf,
} from "@langwatch/browser-host/drawer";
import { useMemo } from "react";

import { useOrganizationHost } from "../model/organization-host.ts";
import type { organizationWeb } from "../organization.web.ts";

/** This module's own drawers and every drawer another module declared, by name. */
type OrganizationDrawerMap = DrawerPropsMapOf<
  (typeof organizationWeb)["types"]["declaration"]["drawers"]
> &
  UiDrawerMap;

export type OrganizationDrawerNavigator = {
  openDrawer: <Name extends string>(
    name: Name,
    props?: Partial<UiDrawerPropsOf<OrganizationDrawerMap, Name>>,
  ) => void;
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
