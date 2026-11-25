import type { Board, Dashboard } from "@langwatch/dashboard-contract";

/** A board as a star list carries it: star lists name no home product. */
export function starredBoardRow({ board }: { board: Board }): Dashboard {
  const { homeProduct: _homeProduct, ...dashboard } = board;
  return dashboard;
}
