import type { ChartFrameDashboardContext } from "@langwatch/analytics-contract/chart-frame-protocol";
import { useColorMode } from "@langwatch/design-system/color-mode";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { DashboardWidgetQuery } from "../model/dashboard-widget-definition.ts";
import { declaredParamDefaults } from "../model/dashboard-widget/params-snapshot.ts";
import { useDashboardWidgetChartNavigate } from "./use-dashboard-widget-chart-navigate.ts";
import { useDashboardWidgetExecutor } from "./use-dashboard-widget-executor.ts";

/** How long the draft sits idle before the chart preview re-mounts. */
const PREVIEW_DEBOUNCE_MS = 600;

/**
 * Shared by the create drawer, card and in-place editor: a debounced
 * draft, its abortable executor, parameter defaults, `LW.navigate`, and
 * `dashboardContext`. Only id/name fields vary; the draft stays per caller.
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

  // Immediately seed the preview, bypassing the debounce. A drawer open/close
  // resets the draft, but the debounced preview would keep showing the just-
  // discarded edit for PREVIEW_DEBOUNCE_MS on the next open — a stale frame the
  // caller flushes past by seeding the reset values synchronously.
  const resetPreview = useCallback((nextCode: string, nextQueries: DashboardWidgetQuery[]) => {
    setPreviewCode(nextCode);
    setPreviewQueries(nextQueries);
  }, []);

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

  const paramsSnapshot = useMemo(() => declaredParamDefaults(previewQueries), [previewQueries]);

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
    resetPreview,
    executeQuery,
    runStandalone,
    lastRuns,
    hostParams,
    paramsSnapshot,
    onNavigate,
    dashboardContext,
  };
}
