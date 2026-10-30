/**
 * The member's stars for the project in scope, boards and From LangWatch boards in one
 * order, and the star/unstar/reorder writes the sidebar offers. A star is personal: one
 * member's stars never show to another. Failures travel raw to the host (#5984).
 */

import { useUiAnalytics } from "@langwatch/browser-host/analytics";
import type { DashboardStar } from "@langwatch/dashboard-contract";

import { analyticsApi } from "../../../behavior/analytics-api.ts";
import { useAnalyticsHost } from "../../../model/analytics-host.ts";
import { dashboardFavourited } from "../model/dashboard-usage-events.ts";
import { type MemberStar, sameStar, starRefOf, swapShownStars } from "../model/sidebar-boards.ts";

export function useFavourites() {
  const host = useAnalyticsHost();
  const analytics = useUiAnalytics();
  const projectId = host.project()?.id ?? "";
  const utils = analyticsApi.useUtils();

  const list = analyticsApi.boards.listStarred.useQuery({ projectId }, { enabled: !!projectId });
  const starMutation = analyticsApi.boards.star.useMutation();
  const unstarMutation = analyticsApi.boards.unstar.useMutation();
  const reorderMutation = analyticsApi.boards.reorderStars.useMutation();

  const stars: MemberStar[] = (list.data ?? []).map((star) =>
    star.kind === "board"
      ? {
          kind: "board",
          board: {
            id: star.dashboard.id,
            projectId: star.dashboard.projectId,
            name: star.dashboard.name,
            description: star.dashboard.description,
            createdById: star.dashboard.createdById,
            scope: star.dashboard.scope,
            organizationId: star.dashboard.organizationId,
            // A star's row names no owner; the sidebar reads it off the listed board.
            ownerProject: null,
          },
        }
      : { kind: "template", templateId: star.templateId },
  );
  const refs = stars.map(starRefOf);

  const refresh = () =>
    Promise.all([
      utils.boards.listStarred.invalidate({ projectId }),
      utils.boards.getAll.invalidate({ projectId }),
    ]);

  const isStarred = (star: DashboardStar) => refs.some((ref) => sameStar(ref, star));

  const toggleStar = (star: DashboardStar) => {
    const starred = !isStarred(star);
    const mutation = starred ? starMutation : unstarMutation;
    mutation.mutate(
      { projectId, star },
      {
        onSuccess: () => {
          analytics.track(dashboardFavourited({ starred }));
          void refresh();
        },
        onError: (error) => host.failed({ error, fallbackTitle: "Couldn't change your stars" }),
      },
    );
  };

  /**
   * Moves one star up or down among the `shown` ones and saves the order; a no-op at the end
   * it faces. Stars the sidebar does not show (My dashboard) keep their position (AC155b).
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
    const from = shown.findIndex((ref) => sameStar(ref, star));
    const to = direction === "up" ? from - 1 : from + 1;
    const order = swapShownStars({ all: refs, shown, from, to });
    if (!order) return;
    reorderMutation.mutate(
      { projectId, stars: order },
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
