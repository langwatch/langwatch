/**
 * Opens the board `/[project]/dashboards` lands on. A member who can see no
 * board gets one made, "My dashboard", visible only to them; the ref keeps
 * a re-run effect (React strict mode) from making a second.
 */

import { useEffect, useRef } from "react";

import { analyticsApi } from "../../../behavior/analytics-api.ts";
import { useAnalyticsHost } from "../../../model/analytics-host.ts";
import { dashboardsPath, FIRST_BOARD_NAME, landingBoardId } from "../model/boards.ts";
import { useSavedDashboards } from "./use-saved-dashboards.ts";

export function useLandingBoard() {
  const host = useAnalyticsHost();
  const saved = useSavedDashboards();
  const utils = analyticsApi.useUtils();
  const create = analyticsApi.dashboards.create.useMutation();
  const createRequested = useRef(false);
  const projectId = host.project()?.id ?? "";
  const { projectSlug, isLoading, loadError } = saved;
  const landingId = landingBoardId({ boards: saved.boards, userId: host.userId() });
  const { mutate: createBoard } = create;

  useEffect(() => {
    if (!projectSlug || isLoading || loadError) return;
    if (landingId !== void 0) {
      host.navigate(dashboardsPath({ projectSlug, dashboardId: landingId }), { replace: true });
      return;
    }
    if (createRequested.current) return;
    createRequested.current = true;
    createBoard(
      { projectId, name: FIRST_BOARD_NAME, visibility: "only_me" },
      // The re-read lists the new board, which this effect then opens.
      { onSuccess: () => void utils.dashboards.getAll.invalidate({ projectId }) },
    );
  }, [host, utils, projectId, projectSlug, isLoading, loadError, landingId, createBoard]);

  return { loadError, createError: create.error };
}
