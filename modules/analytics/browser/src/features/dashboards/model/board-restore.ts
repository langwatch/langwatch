/**
 * What Undo writes to put a board back as it was before a change: the widgets added since go,
 * the ones deleted since come back where they were, edits are reverted and moves are moved
 * back. One plan for every kind of change, so each change undoes the same way. Pure.
 * @see modules/dashboard/specs/dashboards-widget-flow.feature
 */

import type { ChartGridPlacement } from "../../../model/chart-grid.ts";
import type { BoardWidget } from "./board-widgets.ts";

export interface BoardRestorePlan {
  /** Widgets on the board now that were not on it before: deleted. */
  readonly remove: readonly string[];
  /** Widgets that were on the board and are gone: made again, at their old place. */
  readonly recreate: readonly BoardWidget[];
  /** Widgets whose name, code or queries changed: written back as they were. */
  readonly revert: readonly BoardWidget[];
  /** Widgets moved or resized: put back where they were. */
  readonly layouts: readonly ChartGridPlacement[];
}

const sameContent = (a: BoardWidget, b: BoardWidget): boolean =>
  a.name === b.name &&
  a.definition.code === b.definition.code &&
  JSON.stringify(a.definition.queries) === JSON.stringify(b.definition.queries);

const samePlace = (a: ChartGridPlacement, b: ChartGridPlacement): boolean =>
  a.gridColumn === b.gridColumn &&
  a.gridRow === b.gridRow &&
  a.colSpan === b.colSpan &&
  a.rowSpan === b.rowSpan;

/** The writes that turn the board as it is `now` back into the board as it was `before`. */
export function boardRestorePlan({
  before,
  now,
}: {
  before: readonly BoardWidget[];
  now: readonly BoardWidget[];
}): BoardRestorePlan {
  const nowById = new Map(now.map((widget) => [widget.id, widget]));
  const beforeIds = new Set(before.map(({ id }) => id));
  const kept = before.flatMap((widget) => {
    const current = nowById.get(widget.id);
    return current ? [{ widget, current }] : [];
  });
  return {
    remove: now.filter(({ id }) => !beforeIds.has(id)).map(({ id }) => id),
    recreate: before.filter(({ id }) => !nowById.has(id)),
    revert: kept
      .filter(({ widget, current }) => !sameContent(widget, current))
      .map(({ widget }) => widget),
    layouts: kept
      .filter(({ widget, current }) => !samePlace(widget.placement, current.placement))
      .map(({ widget }) => widget.placement),
  };
}
