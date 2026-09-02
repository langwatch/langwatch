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
}

export function DashboardWidgetFrame({
  id,
  graph,
  projectId,
  projectSlug,
  maxHeight,
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

  const { executeQuery, params } = useDashboardWidgetExecutor(
    projectId,
    definition.queries,
    { timeWindow },
  );

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
      params={params}
      theme={colorMode === "dark" ? "dark" : "light"}
      onLog={noopLog}
      onNavigate={onNavigate}
      maxHeight={maxHeight}
    />
  );
}
