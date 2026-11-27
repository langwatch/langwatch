/**
 * A From LangWatch board's widgets on the board grid. Ask Langy, its actions and Export CSV change
 * nothing; a member who may make boards also moves, edits and deletes, each asking first as it
 * makes their own copy. Each widget runs its own queries over the board's period.
 */

import { useMemo } from "react";

import type { ChartGridPlacement } from "../../../../model/chart-grid.ts";
import { ChartGrid } from "../../../../ui/sections/chart-grid.tsx";
import {
  atLeastBoardMinRows,
  BOARD_GRID_ROW_HEIGHT_PX,
  BOARD_MIN_ROW_SPAN,
} from "../../model/board-grid.ts";
import type { BoardPeriod } from "../../model/board-period.ts";
import type { BoardTemplateWidget } from "../../templates/index.ts";
import type { WidgetCardLangy } from "./board-widget-card.tsx";
import { CuratedWidgetCard } from "./curated-widget-card.tsx";

export function CuratedWidgetsGrid({
  projectId,
  projectSlug,
  templateId,
  boardName,
  widgets,
  period,
  periodKey,
  langyFor,
  onEdit,
  onDelete,
  onPlacementsCommit,
  onEmptyChange,
  onLimitFailureChange,
}: {
  projectId: string;
  projectSlug: string;
  templateId: string;
  boardName: string;
  widgets: readonly BoardTemplateWidget[];
  period: BoardPeriod;
  /** The reader's chosen period, such as "1h:auto"; only a new choice restarts the widget. */
  periodKey: string;
  /** What each card asks of Langy; absent when Langy is not available. */
  langyFor?: (widget: BoardTemplateWidget) => Pick<WidgetCardLangy, "ask" | "askAbout" | "act">;
  /** These three are absent for a member who may not make boards: the grid is then read-only. */
  onEdit?: (widget: BoardTemplateWidget) => void;
  onDelete?: (widget: BoardTemplateWidget) => void;
  onPlacementsCommit?: (placements: ChartGridPlacement[]) => void;
  /** Told whether each widget shows none of its data. */
  onEmptyChange?: (input: { widget: BoardTemplateWidget; empty: boolean }) => void;
  /** Told whether each widget's final failure is a resource limit. */
  onLimitFailureChange?: (input: { widget: BoardTemplateWidget; limited: boolean }) => void;
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
      onPlacementsCommit={onPlacementsCommit}
      rowHeightPx={BOARD_GRID_ROW_HEIGHT_PX}
      minRowSpan={BOARD_MIN_ROW_SPAN}
      renderCard={({ graphId, colSpan, rowSpan }) => {
        const widget = byKey.get(graphId);
        if (!widget) return null;
        return (
          <CuratedWidgetCard
            widget={widget}
            frameId={`${templateId}-${graphId}`}
            templateId={templateId}
            boardName={boardName}
            projectId={projectId}
            projectSlug={projectSlug}
            colSpan={colSpan}
            rowSpan={rowSpan}
            timeWindow={timeWindow}
            granularitySeconds={granularitySeconds}
            periodKey={periodKey}
            {...(langyFor ? { langy: langyFor(widget) } : {})}
            onEdit={onEdit && (() => onEdit(widget))}
            onDelete={onDelete && (() => onDelete(widget))}
            onEmptyChange={onEmptyChange && ((empty) => onEmptyChange({ widget, empty }))}
            onLimitFailureChange={
              onLimitFailureChange && ((limited) => onLimitFailureChange({ widget, limited }))
            }
          />
        );
      }}
    />
  );
}
