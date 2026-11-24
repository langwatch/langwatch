/**
 * The header's two writes, the description and the scope, on a stored board or on a new one.
 * On a new board each first stores it, then writes onto the board it became (AC162).
 */

import type { DashboardScope } from "@langwatch/dashboard-contract";

import { useAnalyticsHost } from "../../../model/analytics-host.ts";
import type { ScopeNames } from "../model/board-scope.ts";
import { useBoardDescription } from "./use-board-description.ts";
import type { useBoardScope } from "./use-board-scope.ts";
import type { DraftEdit } from "./use-draft-board.ts";
import type { SavedBoard } from "./use-saved-dashboards.ts";

/** A board "+" opened that nothing has stored yet. */
export type UnsavedBoard = {
  materialise: (edit?: DraftEdit) => Promise<string>;
  /** The last store was refused: the description shown is not stored yet. */
  refused?: boolean;
};

export function useBoardHeaderEdits({
  board,
  unsaved,
  names,
  scope,
}: {
  board: SavedBoard;
  unsaved: UnsavedBoard | undefined;
  names: ScopeNames;
  scope: ReturnType<typeof useBoardScope>;
}) {
  const host = useAnalyticsHost();
  const stored = useBoardDescription({ dashboardId: board.id, stored: board.description });
  if (!unsaved) {
    return {
      description: stored.description,
      saveDescription: stored.saveDescription,
      pickScope: (to: DashboardScope) => scope.request({ board, names, to }),
    };
  }
  const description = board.description ?? "";
  const failed = (fallbackTitle: string) => (error: unknown) =>
    host.failed({ error, fallbackTitle });
  return {
    description,
    saveDescription: (next: string) => {
      const trimmed = next.trim();
      if (trimmed === description && unsaved.refused !== true) return;
      unsaved
        .materialise({ description: trimmed === "" ? null : trimmed })
        .catch(failed("Couldn't save the description"));
    },
    pickScope: (to: DashboardScope) => {
      unsaved
        .materialise()
        .then((id) => scope.request({ board: { ...board, id }, names, to }))
        .catch(failed("Couldn't change who sees the dashboard"));
    },
  };
}
