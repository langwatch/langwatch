/**
 * The sidebar, lent by `SidebarToken` so a peer never imports this closed
 * browser package: fold/expand/restore over the group's own remembered
 * preference. ARCHITECTURE.md §10.1.
 */

import type { NavigationSidebar } from "@langwatch/navigation-client";

import {
  clearSidebarSectionOverrides,
  setSidebarSectionOverride,
} from "./sidebar-section-store.ts";

export const sidebarHostService: NavigationSidebar = {
  expandGroup(id) {
    setSidebarSectionOverride(id, true);
  },
  collapseGroup(id) {
    setSidebarSectionOverride(id, false);
  },
  restoreAll() {
    clearSidebarSectionOverrides();
  },
};

export default sidebarHostService;
