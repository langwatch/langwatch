import { useEffect, useMemo, useState } from "react";

import { useColorMode } from "~/components/ui/color-mode";
import type { DashboardWidgetQuery } from "~/server/analytics/dashboardWidgetDefinition";
import type { ChartFrameDashboardContext } from "./bridge/bridgeProtocol";
import { declaredParamDefaults } from "./paramsSnapshot";
import { useDashboardWidgetChartNavigate } from "./useDashboardWidgetChartNavigate";
import { useDashboardWidgetExecutor } from "./useDashboardWidgetExecutor";

/** How long the draft sits idle before the chart preview re-mounts. */
const PREVIEW_DEBOUNCE_MS = 600;

/**
 * The half of a widget editor that is identical across the create drawer, the
 * card and the in-place editor: a DEBOUNCED copy of the draft (so the frame
 * remounts on settled edits, not every keystroke), the abortable executor its
 * queries run against, the declared-parameter defaults snapshot, the
 * `LW.navigate` host handler, and the `dashboardContext` the frame reads. The
 * draft itself stays with each caller; the optional `widgetId`/`dashboardId`/
 * `widgetName` are the only parts of the context that vary per surface.
 */
export function useWidgetPreview({
  code,
  queries,
  projectId,
  projectSlug,
  timeWindow,
  widgetId,
  dashboardId,
  widgetName,
}: {
  code: string;
  queries: DashboardWidgetQuery[];
  projectId: string;
  projectSlug: string;
  timeWindow?: { start: number; end: number };
  widgetId?: string;
  dashboardId?: string;
  widgetName?: string;
}) {
  const { colorMode } = useColorMode();
  const [previewCode, setPreviewCode] = useState(code);
  const [previewQueries, setPreviewQueries] = useState(queries);
  useEffect(() => {
    const timer = setTimeout(() => {
      setPreviewCode(code);
      setPreviewQueries(queries);
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [code, queries]);

  const {
    executeQuery,
    runStandalone,
    params: hostParams,
    lastRuns,
  } = useDashboardWidgetExecutor(
    projectId,
    previewQueries,
    timeWindow ? { timeWindow } : undefined,
  );

  const paramsSnapshot = useMemo(
    () => declaredParamDefaults(previewQueries),
    [previewQueries],
  );

  const onNavigate = useDashboardWidgetChartNavigate(projectSlug);

  // Mirrors DashboardWidgetFrame's own dashboardContext build — timezone reads
  // the browser's own zone. The widget fields are omitted for the create
  // drawer (no widget exists yet) and set for the card / in-place editor.
  const dashboardContext: ChartFrameDashboardContext = useMemo(
    () => ({
      timeWindow: hostParams.timeWindow,
      granularitySeconds: hostParams.granularitySeconds,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      theme: colorMode === "dark" ? "dark" : "light",
      projectId,
      ...(widgetId !== undefined ? { widgetId } : {}),
      ...(dashboardId !== undefined ? { dashboardId } : {}),
      ...(widgetName !== undefined ? { widgetName } : {}),
    }),
    [hostParams, colorMode, projectId, widgetId, dashboardId, widgetName],
  );

  return {
    previewCode,
    previewQueries,
    executeQuery,
    runStandalone,
    lastRuns,
    hostParams,
    paramsSnapshot,
    onNavigate,
    dashboardContext,
  };
}
