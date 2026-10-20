/**
 * One widget of a From LangWatch board, in the card chrome, read-only: its controls are Ask
 * Langy and a menu that holds only Export CSV, which change nothing. A widget the reader may
 * not see keeps its place and title and offers neither, since both would read its data.
 */

import { useState } from "react";

import type { WidgetFace } from "../../../../model/dashboard-widget/widget-completeness.ts";
import { DashboardWidgetFrameOverWindow } from "../../../dashboard-widget/ui/sections/dashboard-widget-frame.tsx";
import { useWidgetCsvExport } from "../../behavior/use-widget-csv-export.ts";
import type { BoardPeriod } from "../../model/board-period.ts";
import type { BoardTemplateWidget } from "../../templates/index.ts";
import { AskLangyButton } from "../blocks/ask-langy-button.tsx";
import { WidgetCardShell, widgetBodyHeightPx } from "../blocks/widget-card-shell.tsx";
import { WidgetExportMenu } from "../blocks/widget-export-menu.tsx";

export function CuratedWidgetCard({
  widget,
  frameId,
  boardName,
  projectId,
  projectSlug,
  rowSpan,
  timeWindow,
  granularitySeconds,
  excludeOrigins,
  onAskLangy,
}: {
  widget: BoardTemplateWidget;
  /** The frame's id on this board: the template's id and the widget's key. */
  frameId: string;
  /** The board's name, which an exported file is named for. */
  boardName: string;
  projectId: string;
  projectSlug: string;
  rowSpan: number;
  timeWindow: { start: number; end: number };
  granularitySeconds: BoardPeriod["granularitySeconds"];
  /** Trace origins the board leaves out of every query this widget runs. */
  excludeOrigins: readonly string[];
  /** Drafts a prompt about the widget in Langy; absent when Langy is not available. */
  onAskLangy?: () => void;
}) {
  const { name, definition } = widget;
  const [face, setFace] = useState<WidgetFace["kind"]>("chart");
  const canAskLangy = onAskLangy !== undefined && face !== "no_access";
  const csvExport = useWidgetCsvExport({ board: boardName, widget: name });
  const hasControls = canAskLangy || csvExport.item !== undefined;

  return (
    <WidgetCardShell
      name={name}
      description={definition.description}
      controls={
        hasControls && (
          <>
            {canAskLangy && <AskLangyButton name={name} onClick={onAskLangy} />}
            {csvExport.item && <WidgetExportMenu name={name} exportCsv={csvExport.item} />}
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
        maxHeight={widgetBodyHeightPx(rowSpan)}
        timeWindow={timeWindow}
        granularitySeconds={granularitySeconds}
        excludeOrigins={excludeOrigins}
        onFaceChange={setFace}
        onExportChange={csvExport.onExportChange}
      />
    </WidgetCardShell>
  );
}
