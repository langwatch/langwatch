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
 */

import { useEffect, useState } from "react";

import { useColorMode } from "~/components/ui/color-mode";
import { toaster } from "~/components/ui/toaster";
import type { DashboardWidgetQuery } from "~/server/analytics/dashboardWidgetDefinition";
import { api } from "~/utils/api";

import { DashboardWidgetEditDrawer } from "./DashboardWidgetEditDrawer";
import { STARTER_WIDGET_CODE, STARTER_WIDGET_QUERIES } from "./presets";
import { SandboxedChartFrame } from "./SandboxedChartFrame";
import { useDashboardWidgetChartNavigate } from "./useDashboardWidgetChartNavigate";
import { useDashboardWidgetExecutor } from "./useDashboardWidgetExecutor";

const noopLog = () => {
  // Intentionally empty — same reasoning as DashboardWidgetCard: the
  // playground surfaces frame output in the chart itself, no log panel.
};

/** How long the draft sits idle before the chart preview re-mounts. */
const PREVIEW_DEBOUNCE_MS = 600;

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
  const { colorMode } = useColorMode();
  const utils = api.useUtils();
  const createWidget = api.dashboardWidgets.create.useMutation();
  const onNavigate = useDashboardWidgetChartNavigate(projectSlug);

  const [drawerTab, setDrawerTab] = useState<"code" | "queries">("code");
  const [draftName, setDraftName] = useState("New widget");
  const [draftCode, setDraftCode] = useState(STARTER_WIDGET_CODE);
  const [draftQueries, setDraftQueries] = useState<DashboardWidgetQuery[]>(
    STARTER_WIDGET_QUERIES,
  );

  // A fresh starter draft every time the drawer opens — otherwise a second
  // "+ Add chart" would resume whatever was left over from an abandoned
  // first attempt.
  useEffect(() => {
    if (open) {
      setDrawerTab("code");
      setDraftName("New widget");
      setDraftCode(STARTER_WIDGET_CODE);
      setDraftQueries(STARTER_WIDGET_QUERIES);
    }
  }, [open]);

  // The chart's own view of the draft, updated only after typing settles —
  // same debounce reasoning as DashboardWidgetCard.
  const [previewCode, setPreviewCode] = useState(STARTER_WIDGET_CODE);
  const [previewQueries, setPreviewQueries] = useState<DashboardWidgetQuery[]>(
    STARTER_WIDGET_QUERIES,
  );
  useEffect(() => {
    const timer = setTimeout(() => {
      setPreviewCode(draftCode);
      setPreviewQueries(draftQueries);
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [draftCode, draftQueries]);

  const { executeQuery, runStandalone, params, lastRuns } =
    useDashboardWidgetExecutor(projectId, previewQueries);

  const handleSave = () => {
    createWidget.mutate(
      {
        projectId,
        ...(dashboardId ? { dashboardId } : {}),
        name: draftName,
        code: draftCode,
        queries: draftQueries,
      },
      {
        onSuccess: () => {
          void utils.graphs.getAll.invalidate();
          void utils.dashboardWidgets.list.invalidate({ projectId });
          onClose();
        },
        onError: () =>
          toaster.create({
            title: "Error creating widget",
            type: "error",
            duration: 3000,
          }),
      },
    );
  };

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
      isSaving={createWidget.isPending}
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
            params={params}
            theme={colorMode === "dark" ? "dark" : "light"}
            onLog={noopLog}
            onNavigate={onNavigate}
            maxHeight={DRAWER_PREVIEW_HEIGHT_PX}
          />
        ) : null
      }
    />
  );
}
