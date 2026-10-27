/**
 * Whether a stored board's widgets count Langy's conversations, stored on the board through
 * `boards.update` (dashboards-v2 AC200). While a save is in flight the board runs with what was
 * picked; after it, the re-read list. Failures travel raw to the host (#5984).
 */

import { analyticsApi } from "../../../behavior/analytics-api.ts";
import { useAnalyticsHost } from "../../../model/analytics-host.ts";
import {
  boardExcludedOrigins,
  boardIncludesLangy,
  boardOriginsWithLangy,
} from "../model/board-period.ts";

export function useBoardOrigins({
  dashboardId,
  stored,
}: {
  dashboardId: string;
  stored: readonly string[] | null;
}) {
  const host = useAnalyticsHost();
  const project = host.project();
  const projectId = project?.id ?? "";
  const utils = analyticsApi.useUtils();
  const update = analyticsApi.boards.update.useMutation({
    // Returned, so the save stays pending until the list holds the new value.
    onSuccess: () => utils.boards.getAll.invalidate({ projectId }),
    onError: (error) => host.failed({ error, fallbackTitle: "Couldn't save the Langy setting" }),
  });

  const excludedOrigins =
    update.isPending && update.variables.excludedOrigins !== undefined
      ? update.variables.excludedOrigins
      : stored;
  const excluded = boardExcludedOrigins({
    stored: excludedOrigins,
    isPersonalProject: project?.isPersonal === true,
  });
  const includesLangy = boardIncludesLangy({ excluded });

  return {
    /** What `useBoardPeriod` runs the board with. */
    excludedOrigins,
    includesLangy,
    /** Saves the pick; answers whether it changed anything, so the board can refresh. */
    setIncludesLangy: (includeLangy: boolean): boolean => {
      if (includeLangy === includesLangy) return false;
      update.mutate({
        projectId,
        dashboardId,
        excludedOrigins: [...boardOriginsWithLangy({ excluded, includeLangy })],
      });
      return true;
    },
  };
}
