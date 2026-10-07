/**
 * A From LangWatch board's widgets on the board grid, read-only: no drag, resize or menu.
 * A built widget runs its own queries over the board's period; one with no query yet says
 * so in place, and shows no numbers.
 */

import { Box, Text, VStack } from "@langwatch/design-system/primitives";
import { Hammer } from "lucide-react";
import { useMemo } from "react";

import { ChartGrid } from "../../../../ui/sections/chart-grid.tsx";
import { DashboardWidgetFrameOverWindow } from "../../../../ui/sections/dashboard-widget-frame.tsx";
import {
  atLeastBoardMinRows,
  BOARD_GRID_ROW_HEIGHT_PX,
  BOARD_MIN_ROW_SPAN,
} from "../../model/board-grid.ts";
import type { BoardPeriod } from "../../model/board-period.ts";
import type { CuratedWidget } from "../../model/curated-boards.ts";
import { WidgetCardShell, widgetBodyHeightPx } from "../blocks/widget-card-shell.tsx";

const keyOf = (widget: CuratedWidget) => (widget.kind === "built" ? widget.widget.key : widget.key);
const layoutOf = (widget: CuratedWidget) =>
  widget.kind === "built" ? widget.widget.layout : widget.layout;

export function CuratedWidgetsGrid({
  projectId,
  projectSlug,
  templateId,
  widgets,
  period,
}: {
  projectId: string;
  projectSlug: string;
  templateId: string;
  widgets: readonly CuratedWidget[];
  period: BoardPeriod;
}) {
  const { periodStart, periodEnd, granularitySeconds } = period;
  const timeWindow = useMemo(
    () => ({ start: periodStart, end: periodEnd }),
    [periodStart, periodEnd],
  );
  const byKey = new Map(widgets.map((widget) => [keyOf(widget), widget]));
  const placements = widgets.map((widget) =>
    atLeastBoardMinRows({ graphId: keyOf(widget), ...layoutOf(widget) }),
  );

  return (
    <ChartGrid
      placements={placements}
      rowHeightPx={BOARD_GRID_ROW_HEIGHT_PX}
      minRowSpan={BOARD_MIN_ROW_SPAN}
      renderCard={({ graphId, rowSpan }) => {
        const widget = byKey.get(graphId);
        if (!widget) return null;
        if (widget.kind === "not-built") {
          return (
            <WidgetCardShell name={widget.name} description={widget.description}>
              <NotBuiltFace />
            </WidgetCardShell>
          );
        }
        const { name, definition } = widget.widget;
        return (
          <WidgetCardShell name={name} description={definition.description}>
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

/** A widget LangWatch has no query for yet: said plainly, with no chart and no numbers. */
function NotBuiltFace() {
  return (
    <VStack height="full" justify="center" gap={1.5} paddingX={6} textAlign="center">
      <Box display="flex" color="fg.subtle">
        <Hammer size={18} aria-hidden />
      </Box>
      <Text fontSize="13px" fontWeight="medium" color="fg.muted">
        Not built yet
      </Text>
      <Text fontSize="12px" color="fg.subtle" maxWidth="320px">
        LangWatch cannot answer this question from your traces yet, so it shows no numbers.
      </Text>
    </VStack>
  );
}
