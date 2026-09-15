/**
 * "+ Add chart" on a dashboard: same editor as `DashboardWidgetEditDrawer`,
 * but `onSave` creates (pinned to this dashboard) instead of updating. The
 * only working chart-creation entry point while the workbench builder's is disabled.
 */

import { DashboardWidgetEditDrawer } from "./DashboardWidgetEditDrawer.tsx";
import { SandboxedChartFrame } from "./SandboxedChartFrame.tsx";
import { useCreateDashboardWidgetDrawer } from "../../behavior/useCreateDashboardWidgetDrawer.ts";

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
