/**
 * A From LangWatch board's widgets on the board grid, read-only: no drag or resize, only Ask
 * Langy and Export CSV, which change nothing. Each widget runs its own queries over the
 * board's period.
 */

import { useMemo } from "react";

import { ChartGrid } from "../../../../ui/sections/chart-grid.tsx";
import {
  atLeastBoardMinRows,
  BOARD_GRID_ROW_HEIGHT_PX,
  BOARD_MIN_ROW_SPAN,
} from "../../model/board-grid.ts";
import type { BoardPeriod } from "../../model/board-period.ts";
import type { BoardTemplateWidget } from "../../templates/index.ts";
import { CuratedWidgetCard } from "./curated-widget-card.tsx";

export function CuratedWidgetsGrid({
  projectId,
  projectSlug,
  templateId,
  boardName,
  widgets,
  period,
  onAskLangy,
}: {
  projectId: string;
  projectSlug: string;
  templateId: string;
  boardName: string;
  widgets: readonly BoardTemplateWidget[];
  period: BoardPeriod;
  /** Drafts a prompt about the widget in Langy; absent when Langy is not available. */
  onAskLangy?: (widget: BoardTemplateWidget) => void;
}) {
  const { periodStart, periodEnd, granularitySeconds } = period;
  const timeWindow = useMemo(
    () => ({ start: periodStart, end: periodEnd }),
    [periodStart, periodEnd],
  );
  const byKey = new Map(widgets.map((widget) => [widget.key, widget]));
  const placements = widgets.map((widget) =>
    atLeastBoardMinRows({ graphId: widget.key, ...widget.layout }),
  );

  return (
    <ChartGrid
      placements={placements}
      rowHeightPx={BOARD_GRID_ROW_HEIGHT_PX}
      minRowSpan={BOARD_MIN_ROW_SPAN}
      renderCard={({ graphId, rowSpan }) => {
        const widget = byKey.get(graphId);
        if (!widget) return null;
        return (
          <CuratedWidgetCard
            widget={widget}
            frameId={`${templateId}-${graphId}`}
            boardName={boardName}
            projectId={projectId}
            projectSlug={projectSlug}
            rowSpan={rowSpan}
            timeWindow={timeWindow}
            granularitySeconds={granularitySeconds}
            onAskLangy={onAskLangy && (() => onAskLangy(widget))}
          />
        );
      }}
    />
  );
}
