/**
 * The member's starred boards for the project in scope, and the star/unstar/
 * reorder writes the sidebar and the page offer. A star is personal: one
 * member's stars never show to another. Failures travel raw to the host (#5984).
 */

import { analyticsApi } from "../../../behavior/analytics-api.ts";
import { useAnalyticsHost } from "../../../model/analytics-host.ts";

/** One starred board, as the ordered list answers it. */
export type StarredBoard = {
  id: string;
  name: string;
  description: string | null;
  createdById: string | null;
};

function starredBoardOf({ id, name, description, createdById }: StarredBoard): StarredBoard {
  return { id, name, description, createdById };
}

export function useFavourites() {
  const host = useAnalyticsHost();
  const projectId = host.project()?.id ?? "";
  const utils = analyticsApi.useUtils();

  const list = analyticsApi.dashboards.listStarred.useQuery(
    { projectId },
    { enabled: !!projectId },
  );
  const starMutation = analyticsApi.dashboards.star.useMutation();
  const unstarMutation = analyticsApi.dashboards.unstar.useMutation();
  const reorderMutation = analyticsApi.dashboards.reorderStars.useMutation();

  const stars: StarredBoard[] = (list.data ?? []).map(starredBoardOf);

  const refresh = () =>
    Promise.all([
      utils.dashboards.listStarred.invalidate({ projectId }),
      utils.dashboards.getAll.invalidate({ projectId }),
    ]);

  const toggleStar = ({ dashboardId, isStarred }: { dashboardId: string; isStarred: boolean }) => {
    const mutation = isStarred ? unstarMutation : starMutation;
    mutation.mutate(
      { projectId, dashboardId },
      {
        onSuccess: () => void refresh(),
        onError: (error) => host.failed({ error, fallbackTitle: "Couldn't change your stars" }),
      },
    );
  };

  /** Moves one star up or down and saves the new order; a no-op at the end it faces. */
  const moveStar = ({
    dashboardId,
    direction,
  }: {
    dashboardId: string;
    direction: "up" | "down";
  }) => {
    const ids = stars.map((board) => board.id);
    const from = ids.indexOf(dashboardId);
    const to = direction === "up" ? from - 1 : from + 1;
    if (from === -1 || to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to]!, ids[from]!];
    reorderMutation.mutate(
      { projectId, dashboardIds: ids },
      {
        onSuccess: () => void refresh(),
        onError: (error) =>
          host.failed({ error, fallbackTitle: "Couldn't reorder your dashboards" }),
      },
    );
  };

  return {
    stars,
    /** True until the first answer arrives, so a lookup never reads "none" early. */
    isLoading: list.data === void 0 && !list.isError,
    loadError: list.error,
    retry: () => void list.refetch(),
    toggleStar,
    moveStar,
  };
}
