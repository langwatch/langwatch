import { useEffect, useMemo, useState } from "react";

import type { DashboardWidgetQuery } from "../model/dashboard-widget-definition.ts";
import { STARTER_WIDGET_CODE, STARTER_WIDGET_QUERIES } from "../model/dashboard-widget/presets.ts";
import { analyticsApi as api } from "./analytics-api.ts";
import { useShowErrorToast } from "./analytics-feedback.ts";
import { useAnalyticsPeriod } from "./use-analytics-period.ts";
import { useWidgetPreview } from "./use-widget-preview.ts";

/**
 * Create-drawer state: a fresh starter draft, its
 * debounced preview, the executor/context the preview runs against, and the
 * create mutation — kept out so the drawer stays a thin render.
 */
export function useCreateDashboardWidgetDrawer({
  open,
  onClose,
  projectId,
  projectSlug,
  dashboardId,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  projectSlug: string;
  dashboardId: string | undefined;
}) {
  const utils = api.useUtils();
  const createWidget = api.dashboardWidgets.create.useMutation();
  const showErrorToast = useShowErrorToast();

  const [drawerTab, setDrawerTab] = useState<"code" | "queries">("code");
  const [draftName, setDraftName] = useState("New widget");
  const [draftCode, setDraftCode] = useState(STARTER_WIDGET_CODE);
  const [draftQueries, setDraftQueries] = useState<DashboardWidgetQuery[]>(STARTER_WIDGET_QUERIES);

  // The draft previews against the dashboard's own period, the window the
  // widget runs in once placed (as DashboardWidgetFrame reads it), so the
  // preview and the saved card agree on what the query returns.
  const { period } = useAnalyticsPeriod();
  const timeWindow = useMemo(
    () => ({
      start: period.startDate.epochMilliseconds,
      end: period.endDate.epochMilliseconds,
    }),
    [period.startDate, period.endDate],
  );

  const preview = useWidgetPreview({
    code: draftCode,
    queries: draftQueries,
    projectId,
    projectSlug,
    timeWindow,
  });

  // A fresh starter draft every time the drawer opens — otherwise a second
  // "+ Add chart" would resume whatever was left over from an abandoned
  // first attempt. The preview is seeded synchronously alongside the draft so
  // the reopened frame never flashes the discarded attempt for one debounce.
  const { resetPreview } = preview;
  useEffect(() => {
    if (open) {
      setDrawerTab("code");
      setDraftName("New widget");
      setDraftCode(STARTER_WIDGET_CODE);
      setDraftQueries(STARTER_WIDGET_QUERIES);
      resetPreview(STARTER_WIDGET_CODE, STARTER_WIDGET_QUERIES);
    }
  }, [open, resetPreview]);

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
        onError: (error) => showErrorToast({ error, fallbackTitle: "Couldn't create this widget" }),
      },
    );
  };

  return {
    ...preview,
    drawerTab,
    setDrawerTab,
    draftName,
    setDraftName,
    draftCode,
    setDraftCode,
    draftQueries,
    setDraftQueries,
    isSaving: createWidget.isPending,
    handleSave,
  };
}
