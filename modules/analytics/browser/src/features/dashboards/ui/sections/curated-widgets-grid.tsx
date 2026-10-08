/**
 * A From LangWatch board's widgets, read-only: no drag, resize or menu, only Ask Langy, which
 * changes nothing. Each widget runs its own queries over the board's period; one that asks for
 * a height with LW.setHeight gets a card that fits it, and the board restacks.
 */

import { useCallback, useMemo, useState } from "react";

import { ChartGrid } from "../../../../ui/sections/chart-grid.tsx";
import { DashboardWidgetFrameOverWindow } from "../../../../ui/sections/dashboard-widget-frame.tsx";
import {
  atLeastBoardMinRows,
  BOARD_GRID_ROW_HEIGHT_PX,
  BOARD_MIN_ROW_SPAN,
} from "../../model/board-grid.ts";
import type { BoardPeriod } from "../../model/board-period.ts";
import type { BoardTemplateWidget } from "../../templates/index.ts";
import { stackWidgets } from "../../catalogue/index.ts";
import { AskLangyButton } from "../blocks/ask-langy-button.tsx";
import {
  rowSpanForBodyHeightPx,
  WidgetCardShell,
  widgetBodyHeightPx,
} from "../blocks/widget-card-shell.tsx";

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
  const [asked, setAsked] = useState<Readonly<Record<string, number>>>({});
  const onContentHeight = useCallback((key: string, px: number) => {
    setAsked((current) => (current[key] === px ? current : { ...current, [key]: px }));
  }, []);
  const fitted = useMemo(
    () =>
      stackWidgets(
        widgets.map((widget) => {
          const px = asked[widget.key];
          if (px === void 0) return widget;
          return { ...widget, layout: { ...widget.layout, rowSpan: rowSpanForBodyHeightPx(px) } };
        }),
      ),
    [widgets, asked],
  );
  const byKey = new Map(fitted.map((widget) => [widget.key, widget]));
  const placements = fitted.map((widget) =>
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
              onContentHeight={(px) => onContentHeight(graphId, px)}
            />
          </WidgetCardShell>
        );
      }}
    />
  );
}
