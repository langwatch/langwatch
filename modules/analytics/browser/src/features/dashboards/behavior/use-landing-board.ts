/**
 * Opens the member's My dashboard, where `/[project]/dashboards` lands. A member who has
 * none gets it made, empty and starred by nobody; the ref keeps a re-run effect (React
 * strict mode) from making a second.
 */

import { useEffect, useRef } from "react";

import { analyticsApi } from "../../../behavior/analytics-api.ts";
import { useAnalyticsHost } from "../../../model/analytics-host.ts";
import { dashboardsPath, MY_DASHBOARD_NAME, myDashboardId } from "../model/boards.ts";
import { useSavedDashboards } from "./use-saved-dashboards.ts";

export function useLandingBoard() {
  const host = useAnalyticsHost();
  const saved = useSavedDashboards();
  const utils = analyticsApi.useUtils();
  const create = analyticsApi.dashboards.create.useMutation();
  const createRequested = useRef(false);
  const projectId = host.project()?.id ?? "";
  const userId = host.userId();
  const { projectSlug, isLoading, loadError } = saved;
  const myId = myDashboardId({ boards: saved.boards, userId });
  const { mutate: createBoard } = create;

  useEffect(() => {
    if (!projectSlug || isLoading || loadError || userId === void 0) return;
    if (myId !== void 0) {
      host.navigate(dashboardsPath({ projectSlug, dashboardId: myId }), { replace: true });
      return;
    }
    if (createRequested.current) return;
    createRequested.current = true;
    createBoard(
      { projectId, name: MY_DASHBOARD_NAME },
      // The re-read lists the new board, which this effect then opens.
      { onSuccess: () => void utils.dashboards.getAll.invalidate({ projectId }) },
    );
  }, [host, utils, projectId, projectSlug, userId, isLoading, loadError, myId, createBoard]);

  return { loadError, createError: create.error };
}
