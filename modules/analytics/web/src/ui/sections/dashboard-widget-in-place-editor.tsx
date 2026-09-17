/**
 * The edit drawer for a widget already on a dashboard grid, reusing
 * `DashboardWidgetEditDrawer`. The preview is fed a DEBOUNCED draft copy,
 * since the frame fully remounts (fresh CDN/Babel) on identity change, not on every keystroke.
 */

import type { DashboardWidgetDraft } from "../../model/dashboard-widget-definition.ts";
import { DashboardWidgetEditDrawer } from "./dashboard-widget-edit-drawer.tsx";
import { SandboxedChartFrame } from "./sandboxed-chart-frame.tsx";
import { useDashboardWidgetInPlaceEditor } from "../../behavior/use-dashboard-widget-in-place-editor.ts";

/** The drawer's chart preview isn't grid-constrained: a fixed, generous height. */
const DRAWER_PREVIEW_HEIGHT_PX = 320;

// The drawer surfaces frame output in the chart itself; no log panel.
const noopLog = () => {
  // Intentionally empty.
};

export type { DashboardWidgetDraft };

interface DashboardWidgetInPlaceEditorProps {
  open: boolean;
  id: string;
  /** The persisted widget the draft is seeded from and reverted to. */
  widget: DashboardWidgetDraft;
  projectId: string;
  /** Host context for `LW.navigate` from the preview frame. */
  projectSlug: string;
  /** The window the preview's queries run against: the dashboard's own period. */
  timeWindow: { start: number; end: number };
  isSaving: boolean;
  onClose: () => void;
  onSave: (args: { draft: DashboardWidgetDraft; onSuccess: () => void }) => void;
}

export function DashboardWidgetInPlaceEditor({
  open,
  id,
  widget,
  projectId,
  projectSlug,
  timeWindow,
  isSaving,
  onClose,
  onSave,
}: DashboardWidgetInPlaceEditorProps) {
  const {
    activeTab,
    setActiveTab,
    draftName,
    setDraftName,
    draftCode,
    setDraftCode,
    draftQueries,
    setDraftQueries,
    previewCode,
    previewQueries,
    executeQuery,
    runStandalone,
    lastRuns,
    dashboardContext,
    paramsSnapshot,
    onNavigate,
    isDirty,
    handleClose,
    handleSave,
  } = useDashboardWidgetInPlaceEditor({
    id,
    widget,
    projectId,
    projectSlug,
    timeWindow,
    onClose,
    onSave,
  });

  return (
    <DashboardWidgetEditDrawer
      open={open}
      id={id}
      name={draftName}
      onNameChange={setDraftName}
      code={draftCode}
      queries={draftQueries}
      onCodeChange={setDraftCode}
      onQueriesChange={setDraftQueries}
      lastRuns={lastRuns}
      onRun={runStandalone}
      isDirty={isDirty}
      isSaving={isSaving}
      onClose={handleClose}
      onSave={handleSave}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      chart={
        open ? (
          <SandboxedChartFrame
            key={`${previewCode}::${JSON.stringify(previewQueries)}`}
            code={previewCode}
            executeQuery={executeQuery}
            dashboardContext={dashboardContext}
            params={paramsSnapshot}
            onLog={noopLog}
            onNavigate={onNavigate}
            maxHeight={DRAWER_PREVIEW_HEIGHT_PX}
          />
        ) : null
      }
    />
  );
}
