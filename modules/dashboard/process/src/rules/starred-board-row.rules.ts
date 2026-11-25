import type { Board, StarredBoard } from "@langwatch/dashboard-contract";

/** A board as a star list carries it: its icon for the sidebar row, but no home product. */
export function starredBoardRow({ board }: { board: Board }): StarredBoard {
  const { homeProduct: _homeProduct, ...row } = board;
  return row;
}
