import { useEffect, useMemo, useState } from "react";

import { usePeriodSelector } from "~/components/PeriodSelector";
import { toaster } from "~/components/ui/toaster";
import type { DashboardWidgetQuery } from "~/server/analytics/dashboardWidgetDefinition";
import { api } from "~/utils/api";
import { STARTER_WIDGET_CODE, STARTER_WIDGET_QUERIES } from "./presets";
import { useWidgetPreview } from "./useWidgetPreview";

/**
 * All of the "+ Add chart" create-drawer state: a fresh starter draft, the
 * debounced preview it feeds, the executor and dashboard context the preview
 * runs against, and the create mutation. Kept out of the drawer component so
 * that component stays a thin render over `DashboardWidgetEditDrawer`.
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
  const { period } = usePeriodSelector();

  const [drawerTab, setDrawerTab] = useState<"code" | "queries">("code");
  const [draftName, setDraftName] = useState("New widget");
  const [draftCode, setDraftCode] = useState(STARTER_WIDGET_CODE);
  const [draftQueries, setDraftQueries] = useState<DashboardWidgetQuery[]>(
    STARTER_WIDGET_QUERIES,
  );

  // Epoch milliseconds, not Date objects: two Date objects for the same
  // instant are never Object.is-equal, so a dependency built on them would
  // re-run queries on every render. The preview must query the same window
  // the saved card will, so the author sees consistent results between draft
  // and placed widget.
  const timeWindow = useMemo(
    () => ({
      start: period.startDate.getTime(),
      end: period.endDate.getTime(),
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
        onError: () =>
          toaster.create({
            title: "Error creating widget",
            type: "error",
            duration: 3000,
          }),
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
