/**
 * The editor's draft of one widget, or of a new one from the starter chart, and its debounced
 * preview over the board's period and grain. The draft is taken when the editor opens, so a
 * background re-read never overwrites what the member is typing.
 * @see modules/dashboard/specs/dashboards-widget-flow.feature, dashboards-v2.feature AC200
 */

import { useMemo, useState } from "react";

import { useWidgetDraft } from "../../dashboard-widget/behavior/use-widget-draft.ts";
import { useWidgetPreview } from "../../dashboard-widget/behavior/use-widget-preview.ts";
import { BLANK_WIDGET } from "../model/blank-widget.ts";
import {
  type BoardQueryContext,
  boardIncludesLangy,
  boardOriginsWithLangy,
  widgetExcludedOrigins,
} from "../model/board-period.ts";
import type { BoardWidget } from "../model/board-widgets.ts";

/** The widget's "Langy traces" setting as the editor drafts it, seeded from what it runs with. */
function useLangyDraft({
  widget,
  board,
}: {
  widget: BoardWidget | null;
  board: readonly string[];
}) {
  const [seeded] = useState(() =>
    widgetExcludedOrigins({ stored: widget?.definition.excludedOrigins, board }),
  );
  const [excluded, setExcluded] = useState(seeded);
  const included = boardIncludesLangy({ excluded });
  return {
    excluded,
    includesLangy: included,
    isDirty: included !== boardIncludesLangy({ excluded: seeded }),
    setIncludesLangy: (includeLangy: boolean) =>
      setExcluded(boardOriginsWithLangy({ excluded, includeLangy })),
  };
}

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
  period: BoardQueryContext;
}) {
  const seed = widget
    ? { name: widget.name, code: widget.definition.code, queries: widget.definition.queries }
    : BLANK_WIDGET;
  const draft = useWidgetDraft({ widget: seed, isFrozen: true });
  const langy = useLangyDraft({ widget, board: excludeOrigins });
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
    excludeOrigins: langy.excluded,
    dashboardId,
    ...(widget ? { widgetId: widget.id, widgetName: widget.name } : {}),
  });

  return {
    ...draft,
    ...preview,
    /** What the preview leaves out; a new list runs it again (AC200g). */
    previewOrigins: langy.excluded,
    includesLangy: langy.includesLangy,
    setIncludesLangy: langy.setIncludesLangy,
    /** A new widget can always be saved; a saved one once something changed. */
    canSave: widget === null || draft.isDirty || langy.isDirty,
    /** What Save writes: the widget's setting always, so it no longer follows the board. */
    edited: {
      name: draft.draftName,
      code: draft.draftCode,
      queries: draft.draftQueries,
      excludedOrigins: [...langy.excluded],
    },
  };
}
