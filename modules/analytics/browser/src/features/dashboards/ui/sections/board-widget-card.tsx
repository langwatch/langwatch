/**
 * One stored widget on a board, in the card chrome, with the drag handle, Ask Langy and menu
 * as its controls. Drawn over the board's period and grain; the menu opens the board's editor
 * on it, copies its id or API call, and drafts Langy actions on it.
 */

import { Box } from "@langwatch/design-system/primitives";
import { GripVertical } from "lucide-react";
import { useMemo, useState } from "react";

import { useAnalyticsHost } from "../../../../model/analytics-host.ts";
import type { WidgetFace } from "../../../../model/dashboard-widget/widget-completeness.ts";
import { CHART_GRID_DRAG_HANDLE_CLASS } from "../../../../ui/sections/chart-grid.tsx";
import { DashboardWidgetFrameOverWindow } from "../../../dashboard-widget/ui/sections/dashboard-widget-frame.tsx";
import { useWidgetClipboard } from "../../behavior/use-widget-clipboard.ts";
import type { WidgetSetup } from "../../langy/model/board-langy.ts";
import type { BoardPeriod } from "../../model/board-period.ts";
import type { BoardWidget } from "../../model/board-widgets.ts";
import { WIDGET_EDIT_PERMISSION } from "../../model/dashboards-access.ts";
import { AskLangyButton } from "../blocks/ask-langy-button.tsx";
import { WidgetCardShell, widgetBodyHeightPx } from "../blocks/widget-card-shell.tsx";
import { WidgetMenu } from "../blocks/widget-menu.tsx";

/** What a card asks of Langy; every one of them is absent when Langy is not available. */
export interface WidgetCardLangy {
  /** Drafts this widget's prompt. */
  readonly ask: () => void;
  /** Drafts an alert or report on this widget. */
  readonly setUp: (setup: WidgetSetup) => void;
  /** Drafts how to start sending the field this widget's traces lack. */
  readonly setUpMissing: (missing: { field: string; label: string }) => void;
}

export function BoardWidgetCard({
  widget,
  projectId,
  projectSlug,
  dashboardId,
  period,
  isWriting,
  langy,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  widget: BoardWidget;
  projectId: string;
  projectSlug: string;
  dashboardId: string;
  period: BoardPeriod;
  isWriting: boolean;
  langy?: WidgetCardLangy;
  /** Opens the board's editor on this widget, drafting the edit in Langy when asked to. */
  onEdit: (input: { withLangy: boolean }) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const host = useAnalyticsHost();
  const clipboard = useWidgetClipboard({ dashboardId });
  const [face, setFace] = useState<WidgetFace["kind"]>("chart");
  // A widget the reader may not see offers nothing that reads its data: no Langy, alert or report.
  const langyOnData = face === "no_access" ? undefined : langy;
  const canEditCode = face !== "no_access" || host.hasPermission(WIDGET_EDIT_PERMISSION);
  const { periodStart, periodEnd, granularitySeconds } = period;
  const timeWindow = useMemo(
    () => ({ start: periodStart, end: periodEnd }),
    [periodStart, periodEnd],
  );

  return (
    <WidgetCardShell
      name={widget.name}
      description={widget.definition.description}
      controls={
        <>
          <Box
            className={CHART_GRID_DRAG_HANDLE_CLASS}
            display="flex"
            alignItems="center"
            justifyContent="center"
            boxSize={6}
            borderRadius="md"
            cursor="grab"
            color="fg.subtle"
            title="Drag to move"
            _hover={{ color: "fg", background: "bg.muted" }}
          >
            <GripVertical size={14} aria-hidden />
          </Box>
          {langyOnData && <AskLangyButton name={widget.name} onClick={langyOnData.ask} />}
          <WidgetMenu
            name={widget.name}
            disabled={isWriting}
            onEditWithLangy={langyOnData && (() => onEdit({ withLangy: true }))}
            onEditCode={canEditCode ? () => onEdit({ withLangy: false }) : undefined}
            onCopyId={() => clipboard.copyId(widget.id)}
            onCopyApiSnippet={() => clipboard.copyApiSnippet(widget.id)}
            onSetAlert={langyOnData && (() => langyOnData.setUp("alert"))}
            onSendReport={langyOnData && (() => langyOnData.setUp("report"))}
            onDuplicate={onDuplicate}
            onDelete={onDelete}
          />
        </>
      }
    >
      <DashboardWidgetFrameOverWindow
        id={widget.id}
        graph={widget.definition}
        projectId={projectId}
        projectSlug={projectSlug}
        dashboardId={dashboardId}
        widgetName={widget.name}
        maxHeight={widgetBodyHeightPx(widget.placement.rowSpan)}
        timeWindow={timeWindow}
        granularitySeconds={granularitySeconds}
        onFaceChange={setFace}
        {...(langy ? { onAskLangyToSetUp: langy.setUpMissing } : {})}
      />
    </WidgetCardShell>
  );
}
