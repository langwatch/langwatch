/**
 * One stored widget on a board, in the card chrome: Ask Langy, the drag handle and menu, its
 * declared Langy actions and its queries' sources (AC200), over the board's period and grain.
 * Ask Langy also opens the widget large beside Langy (AC121b).
 */

import type { ChartAskSubject } from "@langwatch/analytics-contract/chart-frame-protocol";
import { useContext, useState } from "react";

import { useReadableProjects } from "../../../../behavior/use-readable-projects.ts";
import { useAnalyticsHost } from "../../../../model/analytics-host.ts";
import type { WidgetFace } from "../../../../model/dashboard-widget/widget-completeness.ts";
import { WidgetReadsEveryProjectContext } from "../../../dashboard-widget/behavior/use-dashboard-widget-executor.ts";
import { DashboardWidgetFrameOverWindow } from "../../../dashboard-widget/ui/sections/dashboard-widget-frame.tsx";
import { useWidgetClipboard } from "../../behavior/use-widget-clipboard.ts";
import { useWidgetCsvExport } from "../../behavior/use-widget-csv-export.ts";
import { useWidgetViewed } from "../../behavior/use-widget-viewed.ts";
import { catalogueWidgetActions } from "../../catalogue/index.ts";
import {
  shownWidgetButtons,
  type WidgetAction,
  type WidgetButtonAction,
  type WidgetClickAction,
  type WidgetSetup,
  widgetClickFor,
} from "../../langy/model/board-langy.ts";
import type { BoardPeriod } from "../../model/board-period.ts";
import type { BoardWidget } from "../../model/board-widgets.ts";
import { WIDGET_EDIT_PERMISSION } from "../../model/dashboards-access.ts";
import {
  picksNoSources,
  widgetCardFooter,
  widgetCardSourcesLine,
  widgetProjectsLine,
} from "../../model/widget-sources.ts";
import { AskLangyButton } from "../blocks/ask-langy-button.tsx";
import { NoSourcesPicked } from "../blocks/no-sources-picked.tsx";
import { WidgetActionRow } from "../blocks/widget-action-row.tsx";
import { WidgetCardShell, widgetBodyHeightPx } from "../blocks/widget-card-shell.tsx";
import { WidgetMenu } from "../blocks/widget-menu.tsx";
import { WidgetDragHandle } from "../elements/widget-drag-handle.tsx";
import { WidgetLangyView, widgetViewChartHeightPx } from "./widget-langy-view.tsx";

/** What a card asks of Langy; every one of them is absent when Langy is not available. */
export interface WidgetCardLangy {
  /** Drafts this widget's prompt. */
  readonly ask: () => void;
  /** Drafts an alert or report on this widget. */
  readonly setUp: (setup: WidgetSetup) => void;
  /** Drafts how to start sending the field this widget's traces lack. */
  readonly setUpMissing: (missing: { field: string; label: string }) => void;
  /** Drafts Langy about the value clicked, with the click prompt its widget declares for it. */
  readonly askAbout: (subject: ChartAskSubject, click?: WidgetClickAction) => void;
  /** Drafts one of the buttons its catalogue widget declares. */
  readonly act: (action: WidgetButtonAction) => void;
}

/** A click on the chart drafts Langy with the click prompt its widget declares for that value. */
export function chartAsks({
  langy,
  declared,
}: {
  langy: Pick<WidgetCardLangy, "askAbout"> | undefined;
  declared: readonly WidgetAction[];
}): { onAskLangyAbout?: (subject: ChartAskSubject) => void } {
  if (!langy) return {};
  return {
    onAskLangyAbout: (subject) =>
      langy.askAbout(subject, widgetClickFor({ actions: declared, subject })),
  };
}

/** Who may lift a widget's limit on an editable board, and the edits the face offers them. */
function editableLimitAudience({
  isWriting,
  withLangy,
  canEditCode,
  onEdit,
}: {
  isWriting: boolean;
  withLangy: boolean;
  canEditCode: boolean;
  onEdit: ((input: { withLangy: boolean }) => void) | undefined;
}) {
  return {
    kind: "editable" as const,
    editsDisabled: isWriting,
    ...(withLangy && onEdit ? { onEditWithLangy: () => onEdit({ withLangy: true }) } : {}),
    ...(canEditCode && onEdit ? { onEditCode: () => onEdit({ withLangy: false }) } : {}),
  };
}

export function BoardWidgetCard({
  widget,
  projectId,
  projectSlug,
  dashboardId,
  boardName,
  period,
  periodKey,
  isWriting,
  langy,
  onEdit,
  onDuplicate,
  onDelete,
  onEmptyChange,
  onLimitFailureChange,
}: {
  widget: BoardWidget;
  projectId: string;
  projectSlug: string;
  dashboardId: string;
  /** The board's name, which an exported file is named for. */
  boardName: string;
  period: BoardPeriod;
  /** The reader's chosen period, such as "1h:auto"; only a new choice restarts the widget. */
  periodKey: string;
  isWriting: boolean;
  langy?: WidgetCardLangy;
  /**
   * Opens the board's editor on this widget, drafting the edit in Langy when asked to. Absent,
   * with the two below, on a board the reader cannot edit: the card is then view-only.
   */
  onEdit?: (input: { withLangy: boolean }) => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
  /** Told whether the card shows none of the widget's data. */
  onEmptyChange?: (empty: boolean) => void;
  /** Told whether the card's final failure is a resource limit. */
  onLimitFailureChange?: (limited: boolean) => void;
}) {
  const host = useAnalyticsHost();
  const readable = useReadableProjects({ projectId: host.project()?.id ?? "" });
  const readsEveryProject = useContext(WidgetReadsEveryProjectContext);
  const clipboard = useWidgetClipboard({ dashboardId });
  const csvExport = useWidgetCsvExport({ board: boardName, widget: widget.name });
  const viewRef = useWidgetViewed({ widgetSource: widget.definition.source?.kind ?? "unknown" });
  const [face, setFace] = useState<WidgetFace["kind"]>("chart");
  const [limits, setLimits] = useState("");
  // A widget the reader may not see offers nothing that reads its data: no Langy, alert or report.
  const langyOnData = face === "no_access" ? undefined : langy;
  const canEditCode = face !== "no_access" || host.hasPermission(WIDGET_EDIT_PERMISSION);
  const source = widget.definition.source;
  const declared = langyOnData
    ? catalogueWidgetActions(source?.kind === "catalogue" ? source.catalogueId : undefined)
    : [];
  // The widget's code says whether its problem is on the card; a face over the chart hides it.
  const [problem, setProblem] = useState(false);
  const actions = shownWidgetButtons({ actions: declared, problem: problem && face === "chart" });
  const { periodStart, periodEnd, granularitySeconds } = period;
  const timeWindow = { start: periodStart, end: periodEnd };
  const [isViewOpen, setViewOpen] = useState(false);
  const footer = widgetCardFooter({
    sourcesLine: widgetCardSourcesLine(widget.definition.queries),
    projectsLine: widgetProjectsLine({
      queries: widget.definition.queries,
      boardProjectId: readsEveryProject ? null : (host.project()?.id ?? null),
      readable,
    }),
    limits,
  });
  const actionRow = langyOnData && actions.length > 0 && (
    <WidgetActionRow name={widget.name} actions={actions} onAction={langyOnData.act} />
  );
  /** The widget's frame; only the card's reports what the board counts, such as empty cards. */
  const frame = ({ maxHeight, onCard }: { maxHeight: number; onCard: boolean }) => (
    <DashboardWidgetFrameOverWindow
      id={widget.id}
      graph={widget.definition}
      projectId={projectId}
      projectSlug={projectSlug}
      dashboardId={dashboardId}
      widgetName={widget.name}
      maxHeight={maxHeight}
      timeWindow={timeWindow}
      granularitySeconds={granularitySeconds}
      periodKey={periodKey}
      limitAudience={editableLimitAudience({
        isWriting,
        withLangy: !!langyOnData,
        canEditCode,
        onEdit,
      })}
      {...(onCard
        ? {
            onFaceChange: setFace,
            onLimitsChange: setLimits,
            onExportChange: csvExport.onExportChange,
            onEmptyChange,
            onLimitFailureChange,
          }
        : {})}
      {...(langy ? { onAskLangyToSetUp: langy.setUpMissing } : {})}
      onSignal={({ problem: shows }) => setProblem(shows)}
      {...chartAsks({ langy: langyOnData, declared })}
    />
  );

  const card = (
    <WidgetCardShell
      viewRef={viewRef}
      name={widget.name}
      description={widget.definition.description}
      footer={footer}
      ask={
        langyOnData && (
          <AskLangyButton
            name={widget.name}
            onClick={() => {
              setViewOpen(true);
              langyOnData.ask();
            }}
          />
        )
      }
      actions={actionRow}
      controls={
        <>
          {onEdit && <WidgetDragHandle />}
          <WidgetMenu
            name={widget.name}
            disabled={isWriting}
            onEditWithLangy={langyOnData && onEdit && (() => onEdit({ withLangy: true }))}
            onEditCode={canEditCode && onEdit ? () => onEdit({ withLangy: false }) : undefined}
            onCopyId={() => clipboard.copyId(widget.id)}
            onCopyApiSnippet={onEdit && (() => clipboard.copyApiSnippet(widget.id))}
            exportCsv={csvExport.item}
            onSetAlert={langyOnData && (() => langyOnData.setUp("alert"))}
            onSendReport={langyOnData && (() => langyOnData.setUp("report"))}
            onDuplicate={onDuplicate}
            onDelete={onDelete}
          />
        </>
      }
    >
      {(bodyHeightPx) =>
        picksNoSources(widget.definition.queries) ? (
          <NoSourcesPicked />
        ) : (
          frame({
            maxHeight:
              bodyHeightPx ??
              widgetBodyHeightPx(widget.placement.rowSpan, { withActions: actions.length > 0 }),
            onCard: true,
          })
        )
      }
    </WidgetCardShell>
  );
  if (!isViewOpen || !langyOnData) return card;
  const viewHeightPx = widgetViewChartHeightPx(widgetBodyHeightPx(widget.placement.rowSpan));
  return (
    <>
      {card}
      <WidgetLangyView
        name={widget.name}
        description={widget.definition.description}
        footer={footer}
        actions={actionRow}
        onClose={() => setViewOpen(false)}
        chartHeightPx={viewHeightPx}
        chart={
          picksNoSources(widget.definition.queries) ? (
            <NoSourcesPicked />
          ) : (
            frame({ maxHeight: viewHeightPx, onCard: false })
          )
        }
      />
    </>
  );
}
