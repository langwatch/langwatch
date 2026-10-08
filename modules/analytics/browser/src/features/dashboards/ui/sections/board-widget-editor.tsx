/**
 * The widget editor on a board: the shared edit drawer with a live preview over the board's
 * period, Code, Queries, then "API / MCP" (how the member's own agent makes the widget),
 * with Langy's suggestions above the tabs when Langy is available.
 */

import { LANGY_DOCK_WIDTH_PX } from "@langwatch/langy-contract";
import { useState } from "react";

import type { DashboardWidgetDraft } from "../../../../model/dashboard-widget-definition.ts";
import { DashboardWidgetEditDrawer } from "../../../../ui/sections/dashboard-widget-edit-drawer.tsx";
import { SandboxedChartFrame } from "../../../../ui/sections/sandboxed-chart-frame.tsx";
import { useBoardWidgetEditor } from "../../behavior/use-board-widget-editor.ts";
import type { WidgetAsk } from "../../langy/model/board-langy.ts";
import type { BoardPeriod } from "../../model/board-period.ts";
import type { BoardWidget } from "../../model/board-widgets.ts";
import { widgetApiSnippet, widgetCreatePrompt, widgetMcpSnippet } from "../../model/widget-api.ts";
import { WidgetApiPanel } from "../blocks/widget-api-panel.tsx";
import { WidgetLangyAsks } from "../blocks/widget-langy-asks.tsx";

/** The preview is not grid-constrained in the drawer: a fixed, generous height. */
const PREVIEW_HEIGHT_PX = 320;

/** Langy's dock plus the drawer's own inset and a gap, so the two sit side by side. */
const BESIDE_LANGY_PX = LANGY_DOCK_WIDTH_PX + 24;

// The drawer shows frame output in the chart itself; no log panel.
const noLog = () => void 0;

type EditorTab = "code" | "queries" | "api";

export function BoardWidgetEditor({
  widget,
  projectId,
  projectSlug,
  dashboardId,
  period,
  isSaving,
  asks,
  onAsk,
  onClose,
  onSave,
}: {
  /** The saved widget, or null for a new one. */
  widget: BoardWidget | null;
  projectId: string;
  projectSlug: string;
  dashboardId: string;
  period: BoardPeriod;
  isSaving: boolean;
  /** Langy's suggestions for this widget; absent when Langy is not available. */
  asks?: readonly WidgetAsk[];
  onAsk: (ask: WidgetAsk) => void;
  onClose: () => void;
  onSave: (edited: DashboardWidgetDraft) => void;
}) {
  const [tab, setTab] = useState<EditorTab>("code");
  const editor = useBoardWidgetEditor({ widget, projectId, projectSlug, dashboardId, period });
  const ref = widget && { projectId, dashboardId, widgetId: widget.id };

  return (
    <DashboardWidgetEditDrawer<"api">
      open
      projectId={projectId}
      {...(widget ? { id: widget.id } : {})}
      name={editor.draftName}
      onNameChange={editor.setDraftName}
      code={editor.draftCode}
      queries={editor.draftQueries}
      onCodeChange={editor.setDraftCode}
      onQueriesChange={editor.setDraftQueries}
      lastRuns={editor.lastRuns}
      onRun={editor.runStandalone}
      isDirty={editor.canSave}
      isSaving={isSaving}
      onClose={onClose}
      onSave={() => onSave(editor.edited)}
      // From the left and stopping short of Langy's dock, so the two never overlap.
      placement="start"
      {...(asks ? { reserveEndPx: BESIDE_LANGY_PX } : {})}
      activeTab={tab}
      onTabChange={setTab}
      assist={asks && asks.length > 0 && <WidgetLangyAsks asks={asks} onAsk={onAsk} />}
      extraTabs={[
        {
          value: "api",
          label: "API / MCP",
          content: (
            <WidgetApiPanel
              createPrompt={widgetCreatePrompt({ dashboardId })}
              snippets={
                ref && {
                  widgetId: ref.widgetId,
                  api: widgetApiSnippet({ origin: window.location.origin, widget: ref }),
                  mcp: widgetMcpSnippet(ref),
                }
              }
            />
          ),
        },
      ]}
      chart={
        <SandboxedChartFrame
          key={`${editor.previewCode}::${JSON.stringify(editor.previewQueries)}`}
          code={editor.previewCode}
          executeQuery={editor.executeQuery}
          dashboardContext={editor.dashboardContext}
          params={editor.paramsSnapshot}
          onLog={noLog}
          onNavigate={editor.onNavigate}
          maxHeight={PREVIEW_HEIGHT_PX}
        />
      }
    />
  );
}
