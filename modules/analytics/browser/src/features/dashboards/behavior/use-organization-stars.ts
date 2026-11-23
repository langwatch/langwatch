/**
 * The member's stars across the organization, for the "Starred dashboards" sidebar group:
 * starred boards off `boards.listInOrganization`, the library's own read, and the From
 * LangWatch boards starred in the project in view.
 */

import { analyticsApi } from "../../../behavior/analytics-api.ts";
import { useAnalyticsHost } from "../../../model/analytics-host.ts";
import { CURATED_BOARDS } from "../model/curated-boards.ts";
import {
  libraryBoardOf,
  organizationStarLinks,
  type StarredLibraryLink,
} from "../model/organization-library.ts";
import { useFavourites } from "./use-favourites.ts";

export function useOrganizationStars(): StarredLibraryLink[] {
  const host = useAnalyticsHost();
  const organizationId = host.organizationId() ?? "";
  const list = analyticsApi.boards.listInOrganization.useQuery(
    { organizationId },
    { enabled: organizationId !== "" },
  );
  const favourites = useFavourites();
  const templateIds = favourites.stars.flatMap((star) =>
    star.kind === "template" ? [star.templateId] : [],
  );
  return organizationStarLinks({
    boards: (list.data ?? []).map(libraryBoardOf),
    templateIds,
    curated: CURATED_BOARDS,
    hasProject: host.project() !== void 0,
  });
}
