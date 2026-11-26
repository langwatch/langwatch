/**
 * One product's boards for its sidebar's Dashboards section, off `boards.listInOrganization`
 * (the library's own read, which a create or a move refreshes), for the project in view, in the
 * member's own order (`boards.sidebarOrder`), which a drag rewrites at once. ADR-002, decision 8.
 */

import type { DashboardHomeProduct } from "@langwatch/dashboard-contract";
import { useRef } from "react";

import { analyticsApi } from "../../../behavior/analytics-api.ts";
import { useAnalyticsHost } from "../../../model/analytics-host.ts";
import { type LibraryBoard, libraryBoardOf } from "../model/organization-library.ts";
import { nextSidebarOrder, productSidebarBoards } from "../model/product-dashboards.ts";

export function useProductDashboards({ product }: { product: DashboardHomeProduct }): {
  boards: readonly LibraryBoard[];
  /** Every board the library lists, for numbering a new one in any product. */
  allBoards: readonly LibraryBoard[];
  /** False while the list loads or after it failed, so the section draws nothing. */
  isLoaded: boolean;
  /**
   * Stores the movable boards' new order; the section shows it before the server answers.
   * Unset until the stored order loads, so a save cannot drop another project's slots.
   */
  reorder: ((shownIds: readonly string[]) => void) | undefined;
} {
  const host = useAnalyticsHost();
  const organizationId = host.organizationId() ?? "";
  const utils = analyticsApi.useUtils();
  const list = analyticsApi.boards.listInOrganization.useQuery(
    { organizationId },
    { enabled: organizationId !== "" },
  );
  const orderInput = { organizationId, homeProduct: product };
  const order = analyticsApi.boards.sidebarOrder.useQuery(orderInput, {
    enabled: organizationId !== "",
  });
  const save = analyticsApi.boards.reorderSidebar.useMutation();
  // Per organization and product: the order the server last confirmed and the saves still out.
  const saves = useRef(new Map<string, { confirmed: readonly string[]; pending: number }>());
  const stored = order.data?.dashboardIds ?? [];
  const allBoards = (list.data ?? []).map(libraryBoardOf);
  const boards = productSidebarBoards({
    boards: allBoards,
    product,
    userId: host.userId(),
    projectId: host.project()?.id,
    order: stored,
  });

  const reorder = (shownIds: readonly string[]) => {
    const scope = `${organizationId}:${product}`;
    // With no save out, the cached order is the one the server holds.
    const state = saves.current.get(scope) ?? { confirmed: stored, pending: 0 };
    if (state.pending === 0) state.confirmed = stored;
    state.pending += 1;
    saves.current.set(scope, state);
    const dashboardIds = nextSidebarOrder({ stored, shown: shownIds });
    utils.boards.sidebarOrder.setData(orderInput, { dashboardIds });
    // The last save to settle shows what the server confirmed; until then the drag's order stays.
    const settle = () => {
      state.pending -= 1;
      if (state.pending > 0) return;
      utils.boards.sidebarOrder.setData(orderInput, { dashboardIds: [...state.confirmed] });
    };
    save
      .mutateAsync({ ...orderInput, dashboardIds })
      .then(() => {
        state.confirmed = dashboardIds;
        settle();
      })
      .catch((error: unknown) => {
        settle();
        host.failed({ error, fallbackTitle: "Couldn't save the order of your dashboards" });
      });
  };

  // A failed order read lists the boards by name rather than hiding the section.
  const isOrderSettled = order.data !== void 0 || order.isError;
  return {
    boards,
    allBoards,
    isLoaded: list.data !== void 0 && isOrderSettled,
    reorder: order.data !== void 0 ? reorder : void 0,
  };
}
