/**
 * The `sidebar` capability, published through `withCapabilities` so a peer
 * never imports this closed browser package directly — fold/expand/restore
 * over the group's own remembered preference. ARCHITECTURE.md §10.1.
 */

import {
  clearSidebarSectionOverrides,
  setSidebarSectionOverride,
} from "./sidebar-section-store.ts";

export type NavigationSidebarCapability = {
  expandGroup(id: string): void;
  collapseGroup(id: string): void;
  /** Drops every override; each group returns to its remembered preference. */
  restoreAll(): void;
};

export const sidebarCapability: NavigationSidebarCapability = {
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

export default sidebarCapability;
