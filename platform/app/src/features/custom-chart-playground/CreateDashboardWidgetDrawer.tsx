/**
 * "+ Add chart" on a dashboard: creates a new dashboard widget without
 * leaving the page. Same editor as `DashboardWidgetEditDrawer` (the
 * playground page's own drawer), starter code + a starter query pre-filled
 * (`STARTER_WIDGET_CODE`/`STARTER_WIDGET_QUERIES` — the same defaults the
 * playground's own "+ New widget" button seeds), the only difference is
 * `onSave` calls `create` instead of `update`, with this dashboard's id
 * attached — the widget lands here already pinned, not on the playground's
 * unpinned list waiting for a separate pin step.
 *
 * The workbench builder ("Add chart" used to open `/analytics/custom`) has
 * its save path disabled while the custom-chart-playground is enabled — see
 * `saved_workbench_charts_disabled_for_playground` — so this is the only
 * "create a new chart" entry point that still works from a dashboard.
 *
 * All draft/preview/mutation state lives in `useCreateDashboardWidgetDrawer`;
 * this component only assembles the drawer and its preview frame.
 */

import { DashboardWidgetEditDrawer } from "./DashboardWidgetEditDrawer";
import { SandboxedChartFrame } from "./SandboxedChartFrame";
import { useCreateDashboardWidgetDrawer } from "./useCreateDashboardWidgetDrawer";

const noopLog = () => {
  // Intentionally empty — same reasoning as DashboardWidgetCard: the
  // playground surfaces frame output in the chart itself, no log panel.
};

/** The drawer's own chart preview isn't grid-constrained — a fixed, generous height. */
const DRAWER_PREVIEW_HEIGHT_PX = 320;

export interface CreateDashboardWidgetDrawerProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly projectId: string;
  readonly projectSlug: string;
  /** Pins the new widget straight to this dashboard on creation. */
  readonly dashboardId: string | undefined;
}

export function CreateDashboardWidgetDrawer({
  open,
  onClose,
  projectId,
  projectSlug,
  dashboardId,
}: CreateDashboardWidgetDrawerProps) {
  const {
    drawerTab,
    setDrawerTab,
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
    isSaving,
    handleSave,
  } = useCreateDashboardWidgetDrawer({
    open,
    onClose,
    projectId,
    projectSlug,
    dashboardId,
  });

  return (
    <DashboardWidgetEditDrawer
      open={open}
      name={draftName}
      onNameChange={setDraftName}
      code={draftCode}
      queries={draftQueries}
      onCodeChange={setDraftCode}
      onQueriesChange={setDraftQueries}
      lastRuns={lastRuns}
      onRun={runStandalone}
      isDirty
      isSaving={isSaving}
      onClose={onClose}
      onSave={handleSave}
      activeTab={drawerTab}
      onTabChange={setDrawerTab}
      chart={
        open ? (
          <SandboxedChartFrame
            key={`${previewCode} ${JSON.stringify(previewQueries)}`}
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
