/**
 * One widget of a From LangWatch board, in the card chrome, read-only: its only control is Ask
 * Langy, which changes nothing. A widget the reader may not see keeps its place and title and
 * offers no Ask Langy, which would read the same data.
 */

import { useState } from "react";

import type { WidgetFace } from "../../../../model/dashboard-widget/widget-completeness.ts";
import { DashboardWidgetFrameOverWindow } from "../../../dashboard-widget/ui/sections/dashboard-widget-frame.tsx";
import type { BoardPeriod } from "../../model/board-period.ts";
import type { BoardTemplateWidget } from "../../templates/index.ts";
import { AskLangyButton } from "../blocks/ask-langy-button.tsx";
import { WidgetCardShell, widgetBodyHeightPx } from "../blocks/widget-card-shell.tsx";

export function CuratedWidgetCard({
  widget,
  frameId,
  projectId,
  projectSlug,
  rowSpan,
  timeWindow,
  granularitySeconds,
  onAskLangy,
}: {
  widget: BoardTemplateWidget;
  /** The frame's id on this board: the template's id and the widget's key. */
  frameId: string;
  projectId: string;
  projectSlug: string;
  rowSpan: number;
  timeWindow: { start: number; end: number };
  granularitySeconds: BoardPeriod["granularitySeconds"];
  /** Drafts a prompt about the widget in Langy; absent when Langy is not available. */
  onAskLangy?: () => void;
}) {
  const { name, definition } = widget;
  const [face, setFace] = useState<WidgetFace["kind"]>("chart");
  const canAskLangy = onAskLangy !== undefined && face !== "no_access";

  return (
    <WidgetCardShell
      name={name}
      description={definition.description}
      controls={canAskLangy && <AskLangyButton name={name} onClick={onAskLangy} />}
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
        onFaceChange={setFace}
      />
    </WidgetCardShell>
  );
}
