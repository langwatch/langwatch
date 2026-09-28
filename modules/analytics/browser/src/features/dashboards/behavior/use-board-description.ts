/**
 * A board's description, stored on the board through `dashboards.updateDetails`
 * (AC14). While a save is in flight the board shows what was typed; after it,
 * the re-read list. Failures travel raw to the host (#5984).
 */

import { analyticsApi } from "../../../behavior/analytics-api.ts";
import { useAnalyticsHost } from "../../../model/analytics-host.ts";

export function useBoardDescription({
  dashboardId,
  stored,
}: {
  dashboardId: string;
  stored: string | null;
}) {
  const host = useAnalyticsHost();
  const projectId = host.project()?.id ?? "";
  const utils = analyticsApi.useUtils();
  const update = analyticsApi.dashboards.updateDetails.useMutation({
    // Returned, so the save stays pending until the list holds the new value.
    onSuccess: () => utils.dashboards.getAll.invalidate({ projectId }),
    onError: (error) => host.failed({ error, fallbackTitle: "Couldn't save the description" }),
  });

  const current = stored ?? "";

  return {
    description: update.isPending ? (update.variables.description ?? "") : current,
    saveDescription: (next: string) => {
      const trimmed = next.trim();
      if (trimmed === current) return;
      update.mutate({ projectId, dashboardId, description: trimmed === "" ? null : trimmed });
    },
  };
}
