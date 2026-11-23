/**
 * The board `/dashboards/<id>` names, by `boards.resolve` (ADR-002, decision 3), and where it runs
 * (D2): an LLM Ops Organization board in the project in view, which the top bar switches; any
 * other where `resolve` opens it. Failures travel raw: the page tells not found from a failed read.
 */

import type { DashboardHomeProduct } from "@langwatch/dashboard-contract";

import { analyticsApi } from "../../../behavior/analytics-api.ts";
import { type AnalyticsHostProject, useAnalyticsHost } from "../../../model/analytics-host.ts";
import {
  type OrganizationBoardPlace,
  organizationBoardPlace,
  type ResolvedBoard,
} from "../model/organization-board.ts";

type HomedBoard = ResolvedBoard & { readonly homeProduct: DashboardHomeProduct };

/**
 * Only an LLM Ops Organization board follows the project in view. An Only me board stays in its
 * owner: the server lists it in no other project, so elsewhere it would read as deleted.
 */
function followsProjectInView({ homeProduct, scope }: HomedBoard): boolean {
  return homeProduct === "llm-ops" && scope === "ORGANIZATION";
}

function placeOf({
  board,
  projectInView,
}: {
  board: HomedBoard;
  projectInView: AnalyticsHostProject | undefined;
}): OrganizationBoardPlace {
  const place = organizationBoardPlace(board);
  if (place.kind === "unavailable" || !projectInView || !followsProjectInView(board)) return place;
  const { id, slug, name } = projectInView;
  return { kind: "open", project: { id, slug, name } };
}

export function useOrganizationBoard() {
  const host = useAnalyticsHost();
  const organizationId = host.organizationId() ?? "";
  const dashboardId = host.route().params.dashboardId ?? "";
  const resolved = analyticsApi.boards.resolve.useQuery(
    { organizationId, dashboardId },
    { enabled: organizationId !== "" && dashboardId !== "" },
  );
  const board = resolved.data;
  return {
    place: board ? placeOf({ board, projectInView: host.project() }) : void 0,
    isLoading: board === void 0 && !resolved.isError,
    loadError: resolved.error,
    retry: () => void resolved.refetch(),
  };
}
