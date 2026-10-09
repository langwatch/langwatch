/**
 * A From LangWatch board's widgets on the board grid, read-only: no drag, resize or menu,
 * only Ask Langy, which changes nothing. Each widget runs its own queries over the board's period.
 */

import { useMemo } from "react";

import { ChartGrid } from "../../../../ui/sections/chart-grid.tsx";
import { DashboardWidgetFrameOverWindow } from "../../../dashboard-widget/ui/sections/dashboard-widget-frame.tsx";
import {
  atLeastBoardMinRows,
  BOARD_GRID_ROW_HEIGHT_PX,
  BOARD_MIN_ROW_SPAN,
} from "../../model/board-grid.ts";
import type { BoardPeriod } from "../../model/board-period.ts";
import type { BoardTemplateWidget } from "../../templates/index.ts";
import { AskLangyButton } from "../blocks/ask-langy-button.tsx";
import { WidgetCardShell, widgetBodyHeightPx } from "../blocks/widget-card-shell.tsx";

export function CuratedWidgetsGrid({
  projectId,
  projectSlug,
  templateId,
  widgets,
  period,
  onAskLangy,
}: {
  projectId: string;
  projectSlug: string;
  templateId: string;
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
        const { name, definition } = widget;
        return (
          <WidgetCardShell
            name={name}
            description={definition.description}
            controls={
              onAskLangy && <AskLangyButton name={name} onClick={() => onAskLangy(widget)} />
            }
          >
            <DashboardWidgetFrameOverWindow
              id={`${templateId}-${graphId}`}
              graph={definition}
              projectId={projectId}
              projectSlug={projectSlug}
              widgetName={name}
              maxHeight={widgetBodyHeightPx(rowSpan)}
              timeWindow={timeWindow}
              granularitySeconds={granularitySeconds}
            />
          </WidgetCardShell>
        );
      }}
    />
  );
}
