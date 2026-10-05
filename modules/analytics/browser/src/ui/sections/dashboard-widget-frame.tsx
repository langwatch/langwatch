/**
 * A persisted dashboard widget, rendered read-only — the `dashboard_srcdoc`
 * sibling of `LangWatchQLDashboardWidget`. No live re-fetch: the `CustomGraph`
 * row IS the widget, so the dashboard's list query already has it live.
 */

import type { LangWatchQLAcceptedGranularityStep } from "@langwatch/analytics-contract";
import type { ChartFrameDashboardContext } from "@langwatch/analytics-contract/chart-frame-protocol";
import { useColorMode } from "@langwatch/design-system/color-mode";
import { Box, Text } from "@langwatch/design-system/primitives";
import { useMemo } from "react";

import { useAnalyticsPeriod } from "../../behavior/use-analytics-period.ts";
import { useDashboardWidgetChartNavigate } from "../../behavior/use-dashboard-widget-chart-navigate.ts";
import { useDashboardWidgetExecutor } from "../../behavior/use-dashboard-widget-executor.ts";
import { useFrameDiagnostic } from "../../behavior/use-frame-diagnostic.ts";
import { dashboardWidgetDefinitionSchema } from "../../model/dashboard-widget-definition.ts";
import { declaredParamDefaults } from "../../model/dashboard-widget/params-snapshot.ts";
import { FrameDiagnosticBadge } from "./frame-diagnostic-badge.tsx";
import { SandboxedChartFrame } from "./sandboxed-chart-frame.tsx";
import { useDashboardRefreshedAt } from "./use-dashboard-auto-refresh.ts";

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

/** A widget over the page's period selector, as the analytics dashboard draws it. */
export function DashboardWidgetFrame(props: DashboardWidgetFrameProps) {
  const { period } = useAnalyticsPeriod();

  // Epoch milliseconds, not the `Instant` objects `useAnalyticsPeriod` hands
  // back: two `Instant`s for the same instant are never `Object.is`-equal, so a
  // dependency built on them would re-run the query on every render — the
  // same reasoning `LangWatchQLDashboardWidget` applies to its own run hook.
  const timeWindow = useMemo(
    () => ({
      start: period.startDate.epochMilliseconds,
      end: period.endDate.epochMilliseconds,
    }),
    [period.startDate, period.endDate],
  );

  return <DashboardWidgetFrameOverWindow {...props} timeWindow={timeWindow} />;
}

/**
 * A widget over a window its caller owns, such as a Dashboards board's period.
 * `granularitySeconds`, when given, is the step the reserved parameters carry.
 */
export function DashboardWidgetFrameOverWindow({
  id,
  graph,
  projectId,
  projectSlug,
  maxHeight,
  dashboardId,
  widgetName,
  timeWindow,
  granularitySeconds,
}: DashboardWidgetFrameProps & {
  readonly timeWindow: { start: number; end: number };
  readonly granularitySeconds?: LangWatchQLAcceptedGranularityStep;
}) {
  const { colorMode } = useColorMode();
  const refreshedAt = useDashboardRefreshedAt();
  const onNavigate = useDashboardWidgetChartNavigate(projectSlug);

  // A row this build never wrote — an old shape, a hand-edited one — fails
  // safeParse and degrades to an empty file with no queries rather than
  // crashing the grid.
  const parsed = dashboardWidgetDefinitionSchema.safeParse(graph);
  const definition = parsed.success ? parsed.data : { code: "", queries: [] };

  const { executeQuery, params: hostParams } = useDashboardWidgetExecutor(
    projectId,
    definition.queries,
    granularitySeconds === void 0 ? { timeWindow } : { timeWindow, granularitySeconds },
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
    [hostParams, colorMode, id, projectId, dashboardId, widgetName, refreshedAt],
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
        maxHeight={maxHeight}
      />
      <FrameDiagnosticBadge diagnostic={diagnostic} />
    </Box>
  );
}
