/**
 * One widget of a From LangWatch board, in the card chrome: Ask Langy and Export CSV, and for a
 * member who may make boards the drag handle, "Edit code" and "Delete", each asking first as it
 * makes the member's own copy. A widget the reader may not see offers nothing that reads its data.
 */

import { useState } from "react";

import type { WidgetFace } from "../../../../model/dashboard-widget/widget-completeness.ts";
import { curatedBoardTelemetryId } from "../../../dashboard-widget/model/widget-run-telemetry.ts";
import { DashboardWidgetFrameOverWindow } from "../../../dashboard-widget/ui/sections/dashboard-widget-frame.tsx";
import { useWidgetCsvExport } from "../../behavior/use-widget-csv-export.ts";
import { useWidgetViewed } from "../../behavior/use-widget-viewed.ts";
import type { BoardPeriod } from "../../model/board-period.ts";
import { widgetSourcesLine } from "../../model/widget-sources.ts";
import type { BoardTemplateWidget } from "../../templates/index.ts";
import { AskLangyButton } from "../blocks/ask-langy-button.tsx";
import { WidgetCardShell, widgetBodyHeightPx } from "../blocks/widget-card-shell.tsx";
import { WidgetExportMenu } from "../blocks/widget-export-menu.tsx";
import { WidgetMenu } from "../blocks/widget-menu.tsx";
import { WidgetDragHandle } from "../elements/widget-drag-handle.tsx";

export function CuratedWidgetCard({
  widget,
  frameId,
  templateId,
  boardName,
  projectId,
  projectSlug,
  rowSpan,
  timeWindow,
  granularitySeconds,
  periodKey,
  onAskLangy,
  onEdit,
  onDelete,
  onEmptyChange,
  onLimitFailureChange,
}: {
  widget: BoardTemplateWidget;
  /** The frame's id on this board: the template's id and the widget's key. */
  frameId: string;
  /** The board's template, which its runs are logged under as `curated/<templateId>`. */
  templateId: string;
  /** The board's name, which an exported file is named for. */
  boardName: string;
  projectId: string;
  projectSlug: string;
  rowSpan: number;
  timeWindow: { start: number; end: number };
  granularitySeconds: BoardPeriod["granularitySeconds"];
  /** The reader's chosen period, such as "1h:auto"; only a new choice restarts the widget. */
  periodKey: string;
  /** Drafts a prompt about the widget in Langy; absent when Langy is not available. */
  onAskLangy?: () => void;
  /** These two are absent for a member who may not make boards: the card is then read-only. */
  onEdit?: () => void;
  onDelete?: () => void;
  /** Told whether the card shows none of the widget's data. */
  onEmptyChange?: (empty: boolean) => void;
  /** Told whether the card's final failure is a resource limit. */
  onLimitFailureChange?: (limited: boolean) => void;
}) {
  const { name, definition } = widget;
  const [face, setFace] = useState<WidgetFace["kind"]>("chart");
  const canAskLangy = onAskLangy !== undefined && face !== "no_access";
  const csvExport = useWidgetCsvExport({ board: boardName, widget: name });
  const viewRef = useWidgetViewed({ widgetSource: "curated" });
  const isEditable = onEdit !== undefined || onDelete !== undefined;
  const hasControls = isEditable || canAskLangy || csvExport.item !== undefined;

  return (
    <WidgetCardShell
      viewRef={viewRef}
      name={name}
      description={definition.description}
      footer={widgetSourcesLine(definition.queries)}
      controls={
        hasControls && (
          <>
            {isEditable && <WidgetDragHandle />}
            {canAskLangy && <AskLangyButton name={name} onClick={onAskLangy} />}
            {isEditable ? (
              <WidgetMenu
                name={name}
                disabled={false}
                onEditCode={face === "no_access" ? undefined : onEdit}
                exportCsv={csvExport.item}
                onDelete={onDelete}
              />
            ) : (
              csvExport.item && <WidgetExportMenu name={name} exportCsv={csvExport.item} />
            )}
          </>
        )
      }
    >
      <DashboardWidgetFrameOverWindow
        id={frameId}
        graph={definition}
        projectId={projectId}
        projectSlug={projectSlug}
        widgetName={name}
        telemetry={{
          dashboardId: curatedBoardTelemetryId(templateId),
          widgetId: widget.key,
          templateId: widget.key,
        }}
        maxHeight={widgetBodyHeightPx(rowSpan)}
        timeWindow={timeWindow}
        granularitySeconds={granularitySeconds}
        periodKey={periodKey}
        onFaceChange={setFace}
        limitAudience={{ kind: "built_in" }}
        onExportChange={csvExport.onExportChange}
        onEmptyChange={onEmptyChange}
        onLimitFailureChange={onLimitFailureChange}
      />
    </WidgetCardShell>
  );
}
