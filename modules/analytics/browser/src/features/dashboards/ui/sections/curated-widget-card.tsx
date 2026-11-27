/**
 * One widget of a From LangWatch board: Ask Langy, its Langy actions and Export CSV; for a member
 * who may make boards also the drag handle, "Edit code" and "Delete", each making their own copy.
 * A widget the reader may not see offers nothing that reads its data.
 */

import { useState } from "react";

import type { WidgetFace } from "../../../../model/dashboard-widget/widget-completeness.ts";
import { curatedBoardTelemetryId } from "../../../dashboard-widget/model/widget-run-telemetry.ts";
import { DashboardWidgetFrameOverWindow } from "../../../dashboard-widget/ui/sections/dashboard-widget-frame.tsx";
import { useWidgetCsvExport } from "../../behavior/use-widget-csv-export.ts";
import { useWidgetViewed } from "../../behavior/use-widget-viewed.ts";
import { catalogueWidgetActions } from "../../catalogue/index.ts";
import { shownWidgetButtons } from "../../langy/model/board-langy.ts";
import type { BoardPeriod } from "../../model/board-period.ts";
import { widgetCardFooter, widgetCardSourcesLine } from "../../model/widget-sources.ts";
import type { BoardTemplateWidget } from "../../templates/index.ts";
import { AskLangyButton } from "../blocks/ask-langy-button.tsx";
import { WidgetActionRow } from "../blocks/widget-action-row.tsx";
import { WidgetCardShell, widgetBodyHeightPx } from "../blocks/widget-card-shell.tsx";
import { WidgetExportMenu } from "../blocks/widget-export-menu.tsx";
import { WidgetMenu } from "../blocks/widget-menu.tsx";
import { WidgetDragHandle } from "../elements/widget-drag-handle.tsx";
import { chartAsks, type WidgetCardLangy } from "./board-widget-card.tsx";
import { WidgetLangyView, widgetViewChartHeightPx } from "./widget-langy-view.tsx";

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
  /** What the card asks of Langy; absent when Langy is not available. */
  langy?: Pick<WidgetCardLangy, "ask" | "askAbout" | "act">;
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
  const [spanFloor, setSpanFloor] = useState("");
  const langyOnData = face === "no_access" ? undefined : langy;
  const declared = langyOnData ? catalogueWidgetActions(widget.key) : [];
  // The widget's code says whether its problem is on the card; a face over the chart hides it.
  const [problem, setProblem] = useState(false);
  const actions = shownWidgetButtons({ actions: declared, problem: problem && face === "chart" });
  const csvExport = useWidgetCsvExport({ board: boardName, widget: name });
  const viewRef = useWidgetViewed({ widgetSource: "curated" });
  const isEditable = onEdit !== undefined || onDelete !== undefined;
  const [isViewOpen, setViewOpen] = useState(false);
  const footer = widgetCardFooter({
    sourcesLine: widgetCardSourcesLine(definition.queries),
    projectsLine: "",
    spanFloor,
    limits: "",
  });
  const actionRow = langyOnData && actions.length > 0 && (
    <WidgetActionRow name={name} actions={actions} onAction={langyOnData.act} />
  );
  /** The widget's frame; only the card's reports what the board counts, such as empty cards. */
  const frame = ({ maxHeight, onCard }: { maxHeight: number; onCard: boolean }) => (
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
      maxHeight={maxHeight}
      timeWindow={timeWindow}
      granularitySeconds={granularitySeconds}
      periodKey={periodKey}
      limitAudience={{ kind: "built_in" }}
      {...(onCard
        ? {
            onFaceChange: setFace,
            onSpanFloorNoticeChange: setSpanFloor,
            onExportChange: csvExport.onExportChange,
            onEmptyChange,
            onLimitFailureChange,
          }
        : {})}
      onSignal={({ problem: shows }) => setProblem(shows)}
      {...chartAsks({ langy: langyOnData, declared })}
    />
  );

  const card = (
    <WidgetCardShell
      viewRef={viewRef}
      name={name}
      description={definition.description}
      footer={footer}
      ask={
        langyOnData && (
          <AskLangyButton
            name={name}
            onClick={() => {
              setViewOpen(true);
              langyOnData.ask();
            }}
          />
        )
      }
      actions={actionRow}
      controls={
        isEditable ? (
          <>
            <WidgetDragHandle />
            <WidgetMenu
              name={name}
              disabled={false}
              onEditCode={face === "no_access" ? undefined : onEdit}
              exportCsv={csvExport.item}
              onDelete={onDelete}
            />
          </>
        ) : (
          csvExport.item && <WidgetExportMenu name={name} exportCsv={csvExport.item} />
        )
      }
    >
      {(bodyHeightPx) =>
        frame({
          maxHeight:
            bodyHeightPx ?? widgetBodyHeightPx(rowSpan, { withActions: actions.length > 0 }),
          onCard: true,
        })
      }
    </WidgetCardShell>
  );
  if (!isViewOpen || !langyOnData) return card;
  const viewHeightPx = widgetViewChartHeightPx(widgetBodyHeightPx(rowSpan));
  return (
    <>
      {card}
      <WidgetLangyView
        name={name}
        description={definition.description}
        footer={footer}
        actions={actionRow}
        onClose={() => setViewOpen(false)}
        chartHeightPx={viewHeightPx}
        chart={frame({ maxHeight: viewHeightPx, onCard: false })}
      />
    </>
  );
}
