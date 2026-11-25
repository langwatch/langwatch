/**
 * Which widget the board's editor is open on, from the address, and Langy beside it. Building
 * with Langy, a new widget or "Edit with Langy", sends Langy its starting prompt; "Edit code"
 * only attaches the widget. While it is open Langy is told that widget is on screen.
 * @see modules/dashboard/specs/dashboards-widget-flow.feature
 */

import { useBoardOnScreen, useLangyAsk } from "../langy/behavior/use-board-langy.ts";
import {
  type BoardSubject,
  type EditedWidget,
  NEW_WIDGET_REF,
  type WidgetAsk,
  widgetAskDraft,
  widgetAsks,
  widgetBuildQuestion,
  widgetEditorOpened,
} from "../langy/model/board-langy.ts";
import { BLANK_WIDGET } from "../model/blank-widget.ts";
import type { BoardPeriod } from "../model/board-period.ts";
import type { BoardWidget } from "../model/board-widgets.ts";
import { widgetShape } from "../model/widget-shape.ts";
import { useWidgetEditorAddress } from "./use-widget-editor-address.ts";

/** The widget a draft names: the saved one, or the starter a new widget opens on. */
const editedWidget = (widget: BoardWidget | null): EditedWidget =>
  widget ?? { name: BLANK_WIDGET.name, definition: { queries: BLANK_WIDGET.queries } };

/** The editor the address opens: on a saved widget, on a new one (null), or none at all. */
function openEditor({
  target,
  widgets,
}: {
  target: string | undefined;
  widgets: readonly BoardWidget[];
}): { widget: BoardWidget | null } | null {
  if (target === NEW_WIDGET_REF) return { widget: null };
  const found = widgets.find(({ id }) => id === target);
  return found ? { widget: found } : null;
}

/** Langy's suggestions for the open editor's widget: what fits it, or starting points. */
const asksFor = (widget: BoardWidget | null) =>
  widgetAsks(widget ? widgetShape(widget.definition) : "new");

export function useBoardEditor({
  board,
  period,
  widgets,
}: {
  board: BoardSubject;
  period: BoardPeriod;
  /** The board's widgets; an address naming none of them opens nothing. */
  widgets: readonly BoardWidget[];
}) {
  const langy = useLangyAsk();
  const address = useWidgetEditorAddress();
  const editing = openEditor({ target: address.target, widgets });
  useBoardOnScreen({
    boardId: board.id,
    ...(editing ? { itemRef: editing.widget?.id ?? NEW_WIDGET_REF } : {}),
  });

  const open = ({
    widget,
    withLangy,
    closing,
  }: {
    widget: BoardWidget | null;
    withLangy: boolean;
    /** Address keys this open closes in the same write, such as the picker's. */
    closing?: readonly string[];
  }) => {
    address.open({ target: widget?.id ?? NEW_WIDGET_REF, ...(closing ? { closing } : {}) });
    if (!langy.enabled) return;
    const subject = { widget: editedWidget(widget), board, period };
    const builds = widget === null || withLangy;
    langy.ask(builds ? widgetBuildQuestion(subject) : widgetEditorOpened(subject));
  };

  const asks = editing && langy.enabled ? asksFor(editing.widget) : void 0;

  const ask = (picked: WidgetAsk) => {
    if (!editing) return;
    langy.ask(widgetAskDraft({ ask: picked, widget: editedWidget(editing.widget), board, period }));
  };

  return { editing, open, close: address.close, asks, ask };
}
