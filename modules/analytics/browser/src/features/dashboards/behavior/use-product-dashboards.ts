/**
 * One product's boards for its sidebar's Dashboards section, off `boards.listInOrganization`
 * (the library's own read, which a create or a move refreshes), for the project in view, in the
 * member's own order (`boards.sidebarOrder`), which a drag rewrites at once. ADR-002, decision 8.
 */

import type { DashboardHomeProduct } from "@langwatch/dashboard-contract";
import { useRef, useState } from "react";

import { analyticsApi } from "../../../behavior/analytics-api.ts";
import { useAnalyticsHost } from "../../../model/analytics-host.ts";
import { type LibraryBoard, libraryBoardOf } from "../model/organization-library.ts";
import { nextSidebarOrder, productSidebarBoards } from "../model/product-dashboards.ts";

type SaveQueue = { confirmed: readonly string[]; isSaving: boolean; waiting?: string[] };

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
  const scope = `${organizationId}:${product}`;
  const order = analyticsApi.boards.sidebarOrder.useQuery(orderInput, {
    enabled: organizationId !== "",
  });
  const save = analyticsApi.boards.reorderSidebar.useMutation();
  // While saves are out, the section shows the latest drag's order from here, not the read.
  const [unsaved, setUnsaved] = useState<Readonly<Record<string, readonly string[]>>>({});
  // Per organization and product: the order the server last confirmed, whether a save is out,
  // and the latest drag's order waiting for it, so saves reach the server in drag order.
  const saves = useRef(new Map<string, SaveQueue>());
  const stored = order.data?.dashboardIds ?? [];
  const shown = unsaved[scope] ?? stored;
  const allBoards = (list.data ?? []).map(libraryBoardOf);
  const boards = productSidebarBoards({
    boards: allBoards,
    product,
    userId: host.userId(),
    projectId: host.project()?.id,
    order: shown,
  });

  const reorder = (shownIds: readonly string[]) => {
    const queue = saves.current.get(scope) ?? { confirmed: stored, isSaving: false };
    saves.current.set(scope, queue);
    // With no save out, the read holds what the server stored.
    if (!queue.isSaving) queue.confirmed = stored;
    const dashboardIds = nextSidebarOrder({ stored: shown, shown: shownIds });
    setUnsaved((current) => ({ ...current, [scope]: dashboardIds }));

    // Once the queue is empty, the read gets the confirmed order and the section shows it again.
    const send = (ids: string[]) => {
      queue.isSaving = true;
      const settle = () => {
        queue.isSaving = false;
        const waiting = queue.waiting;
        queue.waiting = void 0;
        if (waiting) return send(waiting);
        utils.boards.sidebarOrder.setData(orderInput, { dashboardIds: [...queue.confirmed] });
        setUnsaved(({ [scope]: _settled, ...rest }) => rest);
      };
      save
        .mutateAsync({ ...orderInput, dashboardIds: ids })
        .then(() => {
          queue.confirmed = ids;
          settle();
        })
        .catch((error: unknown) => {
          host.failed({ error, fallbackTitle: "Couldn't save the order of your dashboards" });
          settle();
        });
    };
    if (queue.isSaving) queue.waiting = dashboardIds;
    else send(dashboardIds);
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
