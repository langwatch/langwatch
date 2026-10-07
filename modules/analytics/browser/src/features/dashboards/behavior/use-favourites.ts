/**
 * The member's stars for the project in scope, boards and From LangWatch boards in one
 * order, and the star/unstar/reorder writes the sidebar offers. A star is personal: one
 * member's stars never show to another. Failures travel raw to the host (#5984).
 */

import type { DashboardStar } from "@langwatch/dashboard-contract";

import { analyticsApi } from "../../../behavior/analytics-api.ts";
import { useAnalyticsHost } from "../../../model/analytics-host.ts";
import { type MemberStar, sameStar, starRefOf } from "../model/sidebar-boards.ts";

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

  const stars: MemberStar[] = (list.data ?? []).map((star) =>
    star.kind === "board"
      ? {
          kind: "board",
          board: {
            id: star.dashboard.id,
            name: star.dashboard.name,
            description: star.dashboard.description,
            createdById: star.dashboard.createdById,
          },
        }
      : { kind: "template", templateId: star.templateId },
  );
  const refs = stars.map(starRefOf);

  const refresh = () =>
    Promise.all([
      utils.dashboards.listStarred.invalidate({ projectId }),
      utils.dashboards.getAll.invalidate({ projectId }),
    ]);

  const isStarred = (star: DashboardStar) => refs.some((ref) => sameStar(ref, star));

  const toggleStar = (star: DashboardStar) => {
    const mutation = isStarred(star) ? unstarMutation : starMutation;
    mutation.mutate(
      { projectId, star },
      {
        onSuccess: () => void refresh(),
        onError: (error) => host.failed({ error, fallbackTitle: "Couldn't change your stars" }),
      },
    );
  };

  /**
   * Moves one star up or down among the `shown` ones and saves the order; a no-op at the end
   * it faces. Stars the sidebar does not show (My dashboard) keep their place after them.
   */
  const moveStar = ({
    star,
    direction,
    shown,
  }: {
    star: DashboardStar;
    direction: "up" | "down";
    shown: readonly DashboardStar[];
  }) => {
    const ordered = [...shown];
    const from = ordered.findIndex((ref) => sameStar(ref, star));
    const to = direction === "up" ? from - 1 : from + 1;
    if (from === -1 || to < 0 || to >= ordered.length) return;
    [ordered[from], ordered[to]] = [ordered[to]!, ordered[from]!];
    const hidden = refs.filter((ref) => !shown.some((visible) => sameStar(visible, ref)));
    reorderMutation.mutate(
      { projectId, stars: [...ordered, ...hidden] },
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
    isStarred,
    toggleStar,
    moveStar,
  };
}
