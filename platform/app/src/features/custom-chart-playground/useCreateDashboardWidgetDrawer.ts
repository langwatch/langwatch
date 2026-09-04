import { useEffect, useState } from "react";

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

  const preview = useWidgetPreview({
    code: draftCode,
    queries: draftQueries,
    projectId,
    projectSlug,
  });

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
