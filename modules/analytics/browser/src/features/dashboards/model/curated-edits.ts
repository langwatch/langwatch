/**
 * The change a member starts on a From LangWatch board, which turns it into their own copy once
 * they confirm (owner, 2026-11-24): what the copy is made of after it. Pure.
 * @see modules/dashboard/specs/dashboards-v2.feature
 */

import type { ChartGridPlacement } from "../../../model/chart-grid.ts";
import type { CuratedBoard } from "./curated-boards.ts";

/** One change to a From LangWatch board, as the member started it. */
export type CuratedEdit =
  | { readonly kind: "rename"; readonly name: string }
  | { readonly kind: "describe"; readonly description: string }
  | { readonly kind: "addWidget" }
  | { readonly kind: "editWidget"; readonly key: string }
  | { readonly kind: "removeWidget"; readonly key: string }
  | { readonly kind: "move"; readonly placements: readonly ChartGridPlacement[] };

/** What the copy is made of: the board's name, description and widgets. */
export type CuratedCopySource = Pick<CuratedBoard, "templateId" | "name" | "job" | "widgets">;

/** Whether the edit changes anything; a blank or unchanged name or description does not. */
export function changesCurated({ board, edit }: { board: CuratedBoard; edit: CuratedEdit }) {
  if (edit.kind === "rename") return edit.name.trim() !== "" && edit.name.trim() !== board.name;
  if (edit.kind === "describe") return edit.description.trim() !== board.job;
  return true;
}

/** The board the copy is made from, with the edit applied where it is a value to keep. */
export function curatedCopySource({
  board,
  edit,
}: {
  board: CuratedBoard;
  edit: CuratedEdit;
}): CuratedCopySource {
  const { templateId, name, job, widgets } = board;
  switch (edit.kind) {
    case "rename":
      return { templateId, name: edit.name.trim(), job, widgets };
    case "describe":
      return { templateId, name, job: edit.description.trim(), widgets };
    case "removeWidget":
      return { templateId, name, job, widgets: widgets.filter(({ key }) => key !== edit.key) };
    case "move": {
      const placed = new Map(edit.placements.map(({ graphId, ...layout }) => [graphId, layout]));
      return {
        templateId,
        name,
        job,
        widgets: widgets.map((widget) => ({
          ...widget,
          layout: placed.get(widget.key) ?? widget.layout,
        })),
      };
    }
    default:
      return { templateId, name, job, widgets };
  }
}
