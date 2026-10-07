/**
 * One stored widget on a board, in the card chrome, with the drag handle, Ask Langy and menu
 * as its controls. Drawn over the board's period and grain; Edit opens the shared in-place
 * editor on its code and queries.
 */

import { Box } from "@langwatch/design-system/primitives";
import { GripVertical } from "lucide-react";
import { useMemo, useState } from "react";

import type { DashboardWidgetDraft } from "../../../../model/dashboard-widget-definition.ts";
import { CHART_GRID_DRAG_HANDLE_CLASS } from "../../../../ui/sections/chart-grid.tsx";
import { DashboardWidgetFrameOverWindow } from "../../../../ui/sections/dashboard-widget-frame.tsx";
import { DashboardWidgetInPlaceEditor } from "../../../../ui/sections/dashboard-widget-in-place-editor.tsx";
import type { WidgetSetup } from "../../langy/model/board-langy.ts";
import type { BoardPeriod } from "../../model/board-period.ts";
import type { BoardWidget } from "../../model/board-widgets.ts";
import { AskLangyButton } from "../blocks/ask-langy-button.tsx";
import { WidgetCardShell, widgetBodyHeightPx } from "../blocks/widget-card-shell.tsx";
import { WidgetMenu } from "../blocks/widget-menu.tsx";

export function BoardWidgetCard({
  widget,
  projectId,
  projectSlug,
  dashboardId,
  period,
  isWriting,
  isSaving,
  onDuplicate,
  onDelete,
  onSave,
  onAskLangy,
  onSetUp,
}: {
  widget: BoardWidget;
  projectId: string;
  projectSlug: string;
  dashboardId: string;
  period: BoardPeriod;
  isWriting: boolean;
  isSaving: boolean;
  onDuplicate: () => void;
  onDelete: () => void;
  onSave: (input: { draft: DashboardWidgetDraft; onSaved: () => void }) => void;
  /** Drafts this widget's prompt in Langy; absent when Langy is not available. */
  onAskLangy?: () => void;
  /** Drafts an alert or report on this widget in Langy; absent when Langy is not available. */
  onSetUp?: (setup: WidgetSetup) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const { periodStart, periodEnd, granularitySeconds } = period;
  const timeWindow = useMemo(
    () => ({ start: periodStart, end: periodEnd }),
    [periodStart, periodEnd],
  );
  const draft: DashboardWidgetDraft = {
    name: widget.name,
    code: widget.definition.code,
    queries: widget.definition.queries,
  };

  return (
    <>
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
            {onAskLangy && <AskLangyButton name={widget.name} onClick={onAskLangy} />}
            <WidgetMenu
              name={widget.name}
              disabled={isWriting}
              onEdit={() => setIsEditing(true)}
              onDuplicate={onDuplicate}
              onSetAlert={onSetUp && (() => onSetUp("alert"))}
              onSendReport={onSetUp && (() => onSetUp("report"))}
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
        />
      </WidgetCardShell>
      <DashboardWidgetInPlaceEditor
        open={isEditing}
        id={widget.id}
        widget={draft}
        projectId={projectId}
        projectSlug={projectSlug}
        timeWindow={timeWindow}
        granularitySeconds={granularitySeconds}
        isSaving={isSaving}
        onClose={() => setIsEditing(false)}
        onSave={({ draft: edited, onSuccess }) => onSave({ draft: edited, onSaved: onSuccess })}
      />
    </>
  );
}
