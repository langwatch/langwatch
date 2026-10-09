/**
 * A kept pointer to a board and one widget on it, looked up now. A pointer is not a
 * dependency: the board can be renamed or deleted and the widget removed after it was kept,
 * so what is drawn is decided here, against the boards and widgets that exist now. Pure.
 */

import { CURATED_SEGMENT, curatedBoardPath, dashboardsPath } from "./boards.ts";
import type { CuratedBoard } from "./curated-boards.ts";

/** What a peer kept: ids, and the names as they were. */
export interface DashboardPointer {
  readonly boardId: string;
  readonly boardName: string;
  readonly widget?: { readonly id: string; readonly name: string };
}

/** One name on the trail: where it leads while it exists, or that it is gone. */
export interface PointerPart {
  readonly name: string;
  /** Absent once the thing is gone, and while it is not known whether it exists. */
  readonly href?: string;
  readonly deleted: boolean;
}

export interface ResolvedPointer {
  readonly board: PointerPart;
  readonly widget?: PointerPart;
}

const kept = (name: string): PointerPart => ({ name, deleted: false });
const gone = (name: string): PointerPart => ({ name, deleted: true });

/** The pointer as it was kept: plain names, neither linked nor called deleted. */
export function keptDashboardPointer(pointer: DashboardPointer): ResolvedPointer {
  return { board: kept(pointer.boardName), ...keptWidget(pointer) };
}

/** A From LangWatch board's pointer id is its address segment, `curated/<templateId>`. */
function curatedTemplateId(boardId: string): string | undefined {
  const prefix = `${CURATED_SEGMENT}/`;
  return boardId.startsWith(prefix) ? boardId.slice(prefix.length) : void 0;
}

/**
 * The board and the widget as they are now. `boards` and `widgets` are undefined while
 * they are not known (loading or failed): the kept names then show as plain text, never
 * as deleted.
 */
export function resolveDashboardPointer({
  pointer,
  boards,
  widgets,
  curated,
  projectSlug,
}: {
  pointer: DashboardPointer;
  boards: readonly { id: string; name: string }[] | undefined;
  widgets: readonly { id: string; name: string; dashboardId: string | null }[] | undefined;
  curated: readonly CuratedBoard[];
  projectSlug: string;
}): ResolvedPointer {
  const templateId = curatedTemplateId(pointer.boardId);
  if (templateId !== void 0) {
    return curatedPointer({ pointer, templateId, curated, projectSlug });
  }
  if (boards === void 0) return keptDashboardPointer(pointer);
  const board = boards.find(({ id }) => id === pointer.boardId);
  if (!board) {
    return { board: gone(pointer.boardName), ...keptWidget(pointer) };
  }
  const href = dashboardsPath({ projectSlug, dashboardId: board.id });
  if (!pointer.widget) return { board: { name: board.name, href, deleted: false } };
  const widgetId = pointer.widget.id;
  const widget = widgets?.find(
    ({ id, dashboardId }) => id === widgetId && dashboardId === board.id,
  );
  return {
    board: { name: board.name, href, deleted: false },
    widget: widgetPart({
      keptName: pointer.widget.name,
      found: widget,
      known: widgets !== void 0,
      href,
    }),
  };
}

function curatedPointer({
  pointer,
  templateId,
  curated,
  projectSlug,
}: {
  pointer: DashboardPointer;
  templateId: string;
  curated: readonly CuratedBoard[];
  projectSlug: string;
}): ResolvedPointer {
  const board = curated.find((each) => each.templateId === templateId);
  if (!board) return { board: gone(pointer.boardName), ...keptWidget(pointer) };
  const href = curatedBoardPath({ projectSlug, templateId });
  if (!pointer.widget) return { board: { name: board.name, href, deleted: false } };
  const widgetKey = pointer.widget.id;
  return {
    board: { name: board.name, href, deleted: false },
    widget: widgetPart({
      keptName: pointer.widget.name,
      found: board.widgets.find(({ key }) => key === widgetKey),
      known: true,
      href,
    }),
  };
}

function keptWidget(pointer: DashboardPointer): { widget?: PointerPart } {
  return pointer.widget ? { widget: kept(pointer.widget.name) } : {};
}

/** A widget has no address of its own yet, so while it exists it leads to its board. */
function widgetPart({
  keptName,
  found,
  known,
  href,
}: {
  keptName: string;
  found: { name: string } | undefined;
  known: boolean;
  href: string;
}): PointerPart {
  if (found) return { name: found.name, href, deleted: false };
  return known ? gone(keptName) : kept(keptName);
}
