/**
 * One persisted dashboard widget, rendered read-only on a
 * dashboard grid — the `dashboard_srcdoc` sibling of
 * `LangWatchQLDashboardWidget`.
 *
 * No live re-fetch by id: unlike a placed workbench chart, a dashboard widget
 * widget has no separate source of truth to drift from. The `CustomGraph`
 * row IS the widget — the playground editor mutates this exact row's `graph`
 * column, so whatever the dashboard's own list query already returned is
 * already live. Editing goes through the playground page; there is no
 * dashboard-side edit drawer yet.
 *
 * The period comes from the dashboard's own period control
 * (`usePeriodSelector`), exactly the way `LangWatchQLDashboardWidget` reads
 * it — one control moves every card, dashboard widgets included. There is
 * no per-card granularity override yet (dashboard widgets carry none the
 * way a placed workbench chart's `granularitySeconds` does), so every card
 * runs at the executor's own default step.
 */

import { Text } from "@chakra-ui/react";
import { useMemo } from "react";

import { usePeriodSelector } from "~/components/PeriodSelector";
import { useColorMode } from "~/components/ui/color-mode";
import { dashboardWidgetDefinitionSchema } from "~/server/analytics/dashboardWidgetDefinition";

import type { ChartFrameDashboardContext } from "./bridge/bridgeProtocol";
import { SandboxedChartFrame } from "./SandboxedChartFrame";
import { useDashboardWidgetChartNavigate } from "./useDashboardWidgetChartNavigate";
import { useDashboardWidgetExecutor } from "./useDashboardWidgetExecutor";

// The dashboard surfaces its own failures around the frame; the frame itself
// has no separate log panel here, matching DashboardWidgetCard's reading.
const noopLog = () => {
  // Intentionally empty.
};

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
  // crashing the grid, the same fallback `CustomChartPlayground.tsx`'s
  // `toWidget` uses on the editor page.
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
    }),
    [hostParams, colorMode, id, projectId, dashboardId, widgetName],
  );

  // Every declared parameter's default, deduped by name across the widget's
  // queries — LW.params has no other source of a value yet (no dashboard-side
  // override UI).
  const paramsSnapshot = useMemo(() => {
    const defaults: Record<string, string | number | boolean> = {};
    for (const query of definition.queries) {
      for (const parameter of query.parameters ?? []) {
        if (parameter.default !== undefined) {
          defaults[parameter.name] = parameter.default;
        }
      }
    }
    return defaults;
  }, [definition.queries]);

  if (!parsed.success) {
    return (
      <Text fontSize="13px" color="fg.muted" padding={4}>
        This widget&apos;s definition could not be read.
      </Text>
    );
  }

  return (
    <SandboxedChartFrame
      key={id}
      code={definition.code}
      executeQuery={executeQuery}
      dashboardContext={dashboardContext}
      params={paramsSnapshot}
      onLog={noopLog}
      onNavigate={onNavigate}
      maxHeight={maxHeight}
    />
  );
}
