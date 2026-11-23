/**
 * The board `/dashboards/<id>` names, resolved by the organization's rule over `boards.resolve`
 * (ADR-002, decision 3). Failures travel raw, so the page tells not found from a failed read.
 */

import { analyticsApi } from "../../../behavior/analytics-api.ts";
import { useAnalyticsHost } from "../../../model/analytics-host.ts";
import { organizationBoardPlace } from "../model/organization-board.ts";

export function useOrganizationBoard() {
  const host = useAnalyticsHost();
  const organizationId = host.organizationId() ?? "";
  const dashboardId = host.route().params.dashboardId ?? "";
  const resolved = analyticsApi.boards.resolve.useQuery(
    { organizationId, dashboardId },
    { enabled: organizationId !== "" && dashboardId !== "" },
  );
  return {
    place: resolved.data ? organizationBoardPlace(resolved.data) : void 0,
    isLoading: resolved.data === void 0 && !resolved.isError,
    loadError: resolved.error,
    retry: () => void resolved.refetch(),
  };
}
