/**
 * The edit drawer for a dashboard widget that already sits on a dashboard
 * grid: the same `DashboardWidgetEditDrawer` the create flow uses, owning the
 * draft (name, code, queries) for one persisted row and handing the parent a
 * single `onSave` with the final draft.
 *
 * The chart previews the draft LIVE. The frame's `code` and the executor's
 * queries are fed from a DEBOUNCED copy of the draft rather than the draft
 * itself: the frame is a full remount (fresh CDN scripts, a fresh Babel
 * compile) on every identity change, and doing that on every keystroke would
 * be exactly as janky as it sounds.
 *
 * Closing (Cancel, the drawer's own close trigger, or clicking outside)
 * reverts the draft, so a discarded edit can never sit around for the next
 * open to reveal. All of that state lives in
 * `useDashboardWidgetInPlaceEditor`; this component only assembles the drawer.
 */

import type { DashboardWidgetQuery } from "~/server/analytics/dashboardWidgetDefinition";
import { DashboardWidgetEditDrawer } from "./DashboardWidgetEditDrawer";
import { SandboxedChartFrame } from "./SandboxedChartFrame";
import { useDashboardWidgetInPlaceEditor } from "./useDashboardWidgetInPlaceEditor";

/** The drawer's chart preview isn't grid-constrained: a fixed, generous height. */
const DRAWER_PREVIEW_HEIGHT_PX = 320;

// The drawer surfaces frame output in the chart itself; no log panel.
const noopLog = () => {
  // Intentionally empty.
};

export interface DashboardWidgetDraft {
  name: string;
  code: string;
  queries: DashboardWidgetQuery[];
}

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
  onSave: (args: {
    draft: DashboardWidgetDraft;
    onSuccess: () => void;
  }) => void;
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
