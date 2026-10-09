/**
 * The editor's draft of one widget, or of a new one from the starter chart, and its debounced
 * preview over the board's period and grain. The draft is taken when the editor opens, so a
 * background re-read never overwrites what the member is typing.
 * @see modules/dashboard/specs/dashboards-widget-flow.feature
 */

import { useMemo } from "react";

import { useWidgetDraft } from "../../../behavior/use-widget-draft.ts";
import { useWidgetPreview } from "../../../behavior/use-widget-preview.ts";
import { BLANK_WIDGET } from "../model/blank-widget.ts";
import type { BoardScope } from "../model/board-period.ts";
import type { BoardWidget } from "../model/board-widgets.ts";

export function useBoardWidgetEditor({
  widget,
  projectId,
  projectSlug,
  dashboardId,
  period: { periodStart, periodEnd, granularitySeconds, excludeOrigins },
}: {
  /** The saved widget, or null for a new one. */
  widget: BoardWidget | null;
  projectId: string;
  projectSlug: string;
  dashboardId: string;
  period: BoardScope;
}) {
  const seed = widget
    ? { name: widget.name, code: widget.definition.code, queries: widget.definition.queries }
    : BLANK_WIDGET;
  const draft = useWidgetDraft({ widget: seed, isFrozen: true });
  const timeWindow = useMemo(
    () => ({ start: periodStart, end: periodEnd }),
    [periodStart, periodEnd],
  );
  const preview = useWidgetPreview({
    code: draft.draftCode,
    queries: draft.draftQueries,
    projectId,
    projectSlug,
    timeWindow,
    granularitySeconds,
    excludeOrigins,
    dashboardId,
    ...(widget ? { widgetId: widget.id, widgetName: widget.name } : {}),
  });

  return {
    ...draft,
    ...preview,
    /** A new widget can always be saved; a saved one once something changed. */
    canSave: widget === null || draft.isDirty,
    /** What Save writes. */
    edited: { name: draft.draftName, code: draft.draftCode, queries: draft.draftQueries },
  };
}
