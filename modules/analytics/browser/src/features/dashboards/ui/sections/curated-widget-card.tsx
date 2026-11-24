/**
 * One widget of a From LangWatch board, in the card chrome, read-only: Ask Langy, its declared
 * Langy actions and a menu that holds only Export CSV, which change nothing. A widget the reader
 * may not see keeps its place and title and offers none, since they would read its data.
 */

import { useState } from "react";

import type { WidgetFace } from "../../../../model/dashboard-widget/widget-completeness.ts";
import { curatedBoardTelemetryId } from "../../../dashboard-widget/model/widget-run-telemetry.ts";
import { DashboardWidgetFrameOverWindow } from "../../../dashboard-widget/ui/sections/dashboard-widget-frame.tsx";
import { useWidgetCsvExport } from "../../behavior/use-widget-csv-export.ts";
import { useWidgetViewed } from "../../behavior/use-widget-viewed.ts";
import { catalogueWidgetActions } from "../../catalogue/index.ts";
import type { BoardPeriod } from "../../model/board-period.ts";
import { widgetCardSourcesLine } from "../../model/widget-sources.ts";
import type { BoardTemplateWidget } from "../../templates/index.ts";
import { AskLangyButton } from "../blocks/ask-langy-button.tsx";
import { WidgetActionRow } from "../blocks/widget-action-row.tsx";
import { WidgetCardShell, widgetBodyHeightPx } from "../blocks/widget-card-shell.tsx";
import { WidgetExportMenu } from "../blocks/widget-export-menu.tsx";
import type { WidgetCardLangy } from "./board-widget-card.tsx";

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
  langy,
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
  /** What the card asks of Langy; absent when Langy is not available. */
  langy?: Pick<WidgetCardLangy, "ask" | "askAbout" | "act">;
  /** Told whether the card shows none of the widget's data. */
  onEmptyChange?: (empty: boolean) => void;
  /** Told whether the card's final failure is a resource limit. */
  onLimitFailureChange?: (limited: boolean) => void;
}) {
  const { name, definition } = widget;
  const [face, setFace] = useState<WidgetFace["kind"]>("chart");
  const langyOnData = face === "no_access" ? undefined : langy;
  const actions = langyOnData ? catalogueWidgetActions(widget.key) : [];
  const csvExport = useWidgetCsvExport({ board: boardName, widget: name });
  const viewRef = useWidgetViewed({ widgetSource: "curated" });

  return (
    <WidgetCardShell
      viewRef={viewRef}
      name={name}
      description={definition.description}
      footer={widgetCardSourcesLine(definition.queries)}
      ask={langyOnData && <AskLangyButton name={name} onClick={langyOnData.ask} />}
      actions={
        langyOnData &&
        actions.length > 0 && (
          <WidgetActionRow name={name} actions={actions} onAction={langyOnData.act} />
        )
      }
      controls={csvExport.item && <WidgetExportMenu name={name} exportCsv={csvExport.item} />}
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
        maxHeight={widgetBodyHeightPx(rowSpan, { withActions: actions.length > 0 })}
        timeWindow={timeWindow}
        granularitySeconds={granularitySeconds}
        periodKey={periodKey}
        onFaceChange={setFace}
        limitAudience={{ kind: "built_in" }}
        onExportChange={csvExport.onExportChange}
        onEmptyChange={onEmptyChange}
        onLimitFailureChange={onLimitFailureChange}
        {...(langyOnData ? { onAskLangyAbout: langyOnData.askAbout } : {})}
      />
    </WidgetCardShell>
  );
}
