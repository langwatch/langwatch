/**
 * One product's boards for its sidebar's Dashboards section, off `boards.listInOrganization`
 * (the library's own read, which a create or a move refreshes) and the member's stars in the
 * project in view. ADR-002, decision 8.
 */

import type { DashboardHomeProduct } from "@langwatch/dashboard-contract";

import { analyticsApi } from "../../../behavior/analytics-api.ts";
import { useAnalyticsHost } from "../../../model/analytics-host.ts";
import { CURATED_BOARDS } from "../model/curated-boards.ts";
import { type LibraryBoard, libraryBoardOf } from "../model/organization-library.ts";
import { type ProductSidebarBoards, productSidebarBoards } from "../model/product-dashboards.ts";
import { useFavourites } from "./use-favourites.ts";

export function useProductDashboards({ product }: { product: DashboardHomeProduct }): {
  boards: ProductSidebarBoards;
  /** Every board the library lists, for numbering a new one in any product. */
  allBoards: readonly LibraryBoard[];
  /** False while the list loads or after it failed, so the section draws nothing. */
  isLoaded: boolean;
} {
  const host = useAnalyticsHost();
  const organizationId = host.organizationId() ?? "";
  const list = analyticsApi.boards.listInOrganization.useQuery(
    { organizationId },
    { enabled: organizationId !== "" },
  );
  const favourites = useFavourites();
  const starredTemplateIds = favourites.stars.flatMap((star) =>
    star.kind === "template" ? [star.templateId] : [],
  );
  const allBoards = (list.data ?? []).map(libraryBoardOf);
  const boards = productSidebarBoards({
    boards: allBoards,
    product,
    userId: host.userId(),
    curated: CURATED_BOARDS,
    starredTemplateIds,
    hasProject: host.project() !== void 0,
  });
  return { boards, allBoards, isLoaded: list.data !== void 0 };
}
