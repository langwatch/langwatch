/**
 * One persisted dashboard widget, rendered read-only on a
 * dashboard grid — the `dashboard_srcdoc` sibling of
 * `LangWatchQLDashboardWidget`.
 *
 * No live re-fetch by id: unlike a placed workbench chart, a dashboard widget
 * widget has no separate source of truth to drift from. The `CustomGraph`
 * row IS the widget: the card's Edit drawer (`DashboardWidgetInPlaceEditor`)
 * mutates this exact row's `graph` column, so whatever the dashboard's own
 * list query already returned is already live.
 *
 * The period comes from the dashboard's own period control
 * (`usePeriodSelector`), exactly the way `LangWatchQLDashboardWidget` reads
 * it — one control moves every card, dashboard widgets included. There is
 * no per-card granularity override yet (dashboard widgets carry none the
 * way a placed workbench chart's `granularitySeconds` does), so every card
 * runs at the executor's own default step.
 */

import { Box, Text } from "@chakra-ui/react";
import { useCallback, useEffect, useMemo } from "react";

import { useDashboardRefreshedAt } from "~/components/analytics/useDashboardAutoRefresh";
import { usePeriodSelector } from "~/components/PeriodSelector";
import { useColorMode } from "~/components/ui/color-mode";
import { dashboardWidgetDefinitionSchema } from "~/server/analytics/dashboardWidgetDefinition";

import type { ChartFrameDashboardContext } from "./bridge/bridgeProtocol";
import type { ChartFrameRenderReceipt } from "./bridge/frameBridge";
import { FrameDiagnosticBadge } from "./FrameDiagnosticBadge";
import { declaredParamDefaults } from "./paramsSnapshot";
import { useWidgetRenderReceiptStore } from "./renderReceipt/widgetRenderReceiptStore";
import { SandboxedChartFrame } from "./SandboxedChartFrame";
import { useDashboardWidgetChartNavigate } from "./useDashboardWidgetChartNavigate";
import { useDashboardWidgetExecutor } from "./useDashboardWidgetExecutor";
import { useFrameDiagnostic } from "./useFrameDiagnostic";

export interface DashboardWidgetFrameProps {
  readonly id: string;
  /** The row's `CustomGraph.graph` column — a `DashboardWidgetDefinition`. */
  readonly graph: unknown;
  readonly projectId: string;
  /** Host context for `LW.navigate` — never read off the frame's own params. */
  readonly projectSlug: string;
  readonly maxHeight: number;
  /** The dashboard this widget is placed on, where the caller has one. */
  readonly dashboardId?: string;
  /** The widget's own name, for LW.dashboardContext.widgetName. */
  readonly widgetName?: string;
}

export function DashboardWidgetFrame({
  id,
  graph,
  projectId,
  projectSlug,
  maxHeight,
  dashboardId,
  widgetName,
}: DashboardWidgetFrameProps) {
  const { colorMode } = useColorMode();
  const { period } = usePeriodSelector();
  const refreshedAt = useDashboardRefreshedAt();
  const onNavigate = useDashboardWidgetChartNavigate(projectSlug);

  // Epoch milliseconds, not the `Date` objects `usePeriodSelector` hands
  // back: two `Date`s for the same instant are never `Object.is`-equal, so a
  // dependency built on them would re-run the query on every render — the
  // same reasoning `LangWatchQLDashboardWidget` applies to its own run hook.
  const timeWindow = useMemo(
    () => ({
      start: period.startDate.getTime(),
      end: period.endDate.getTime(),
    }),
    [period.startDate, period.endDate],
  );

  // A row this build never wrote — an old shape, a hand-edited one — fails
  // safeParse and degrades to an empty file with no queries rather than
  // crashing the grid.
  const parsed = dashboardWidgetDefinitionSchema.safeParse(graph);
  const definition = parsed.success ? parsed.data : { code: "", queries: [] };

  const { executeQuery, params: hostParams } = useDashboardWidgetExecutor(
    projectId,
    definition.queries,
    { timeWindow },
  );

  // Known host-side at this boundary; timezone reads the browser's own zone
  // the same way a widget's clock would. dashboardId/widgetName are optional
  // on the wire — omitted where a caller (e.g. the playground) has none.
  // refreshedAt is the dashboard's scheduled-refresh clock: a new value is a
  // context change the frame's useChartQuery re-runs on.
  const dashboardContext: ChartFrameDashboardContext = useMemo(
    () => ({
      timeWindow: hostParams.timeWindow,
      granularitySeconds: hostParams.granularitySeconds,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      theme: colorMode === "dark" ? "dark" : "light",
      widgetId: id,
      projectId,
      dashboardId,
      widgetName,
      ...(refreshedAt === undefined ? {} : { refreshedAt }),
    }),
    [
      hostParams,
      colorMode,
      id,
      projectId,
      dashboardId,
      widgetName,
      refreshedAt,
    ],
  );

  // LW.params has no other source of a value yet (no dashboard-side
  // override UI).
  const paramsSnapshot = useMemo(
    () => declaredParamDefaults(definition.queries),
    [definition.queries],
  );

  // A compile or render error the widget reports is the code's own doing —
  // shown on the card, never restarted.
  const { diagnostic, onLog } = useFrameDiagnostic({
    resetKey: definition.code,
  });

  // The render receipt — what the frame actually painted — is kept per widget
  // so an off-screen agent (Langy) can read this card through
  // `dashboard.getWidgetRender`. It exists only while this card is mounted, so
  // it is dropped when the card leaves the grid.
  const publishReceipt = useWidgetRenderReceiptStore((state) => state.publish);
  const removeReceipt = useWidgetRenderReceiptStore((state) => state.remove);
  const onRenderReceipt = useCallback(
    (receipt: ChartFrameRenderReceipt) => {
      publishReceipt({
        ...receipt,
        widgetId: id,
        widgetName,
        dashboardId,
        theme: dashboardContext.theme,
        timeWindow: dashboardContext.timeWindow,
        capturedAt: Date.now(),
      });
    },
    [
      publishReceipt,
      id,
      widgetName,
      dashboardId,
      dashboardContext.theme,
      dashboardContext.timeWindow,
    ],
  );
  useEffect(() => () => removeReceipt(id), [id, removeReceipt]);

  if (!parsed.success) {
    return (
      <Text fontSize="13px" color="fg.muted" padding={4}>
        This widget&apos;s definition could not be read.
      </Text>
    );
  }

  return (
    <Box position="relative">
      <SandboxedChartFrame
        key={id}
        code={definition.code}
        executeQuery={executeQuery}
        dashboardContext={dashboardContext}
        params={paramsSnapshot}
        onLog={onLog}
        onNavigate={onNavigate}
        onRenderReceipt={onRenderReceipt}
        maxHeight={maxHeight}
      />
      <FrameDiagnosticBadge diagnostic={diagnostic} />
    </Box>
  );
}
