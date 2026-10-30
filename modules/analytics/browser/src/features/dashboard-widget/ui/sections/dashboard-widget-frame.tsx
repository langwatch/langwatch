/**
 * A persisted dashboard widget, rendered read-only — the `dashboard_srcdoc`
 * sibling of `LangWatchQLDashboardWidget`. No live re-fetch: the `CustomGraph`
 * row IS the widget, so the dashboard's list query already has it live.
 */

import type { LangWatchQLAcceptedGranularityStep } from "@langwatch/analytics-contract";
import type {
  ChartFrameDashboardContext,
  NavigableTarget,
} from "@langwatch/analytics-contract/chart-frame-protocol";
import { dashboardWidgetDefinitionSchema } from "@langwatch/analytics-contract/dashboard-widget-definition";
import { useColorMode } from "@langwatch/design-system/color-mode";
import { Box, Text } from "@langwatch/design-system/primitives";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useAnalyticsPeriod } from "../../../../behavior/use-analytics-period.ts";
import { useFrameDiagnostic } from "../../../../behavior/use-frame-diagnostic.ts";
import { useWidgetQueryRecords } from "../../../../behavior/use-widget-query-records.ts";
import { usePublishWidgetCompleteness } from "../../../../behavior/widget-completeness-sink.ts";
import { projectAwaitsFirstTrace, useAnalyticsHost } from "../../../../model/analytics-host.ts";
import { declaredParamDefaults } from "../../../../model/dashboard-widget/params-snapshot.ts";
import { withheldWords } from "../../../../model/dashboard-widget/widget-access.ts";
import {
  awaitsFirstAnswer,
  type WidgetFace,
  widgetFace,
} from "../../../../model/dashboard-widget/widget-completeness.ts";
import {
  type WidgetExport,
  widgetExportStatus,
  widgetShowsNoData,
} from "../../../../model/dashboard-widget/widget-export.ts";
import {
  missingFieldGuidance,
  noTrafficGuidance,
} from "../../../../model/dashboard-widget/widget-guidance.ts";
import {
  WidgetFailedFace,
  WidgetLoadingFace,
  WidgetNoAccessFace,
  WidgetNoTrafficFace,
  WidgetSetupFace,
} from "../../../../ui/elements/widget-state-face.tsx";
import { useDashboardRefreshedAt } from "../../../../ui/sections/use-dashboard-auto-refresh.ts";
import { useDashboardWidgetChartNavigate } from "../../behavior/use-dashboard-widget-chart-navigate.ts";
import { useDashboardWidgetExecutor } from "../../behavior/use-dashboard-widget-executor.ts";
import { useSlowLoading } from "../../behavior/use-slow-loading.ts";
import { FrameDiagnosticBadge } from "./frame-diagnostic-badge.tsx";
import { SandboxedChartFrame } from "./sandboxed-chart-frame.tsx";

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

/** What a widget over a window its caller owns takes, such as a Dashboards board's period. */
type DashboardWidgetFrameOverWindowProps = DashboardWidgetFrameProps & {
  readonly timeWindow: { start: number; end: number };
  readonly granularitySeconds?: LangWatchQLAcceptedGranularityStep;
  /** Drafts the step that sends a field no trace carries; absent, the setup view has no button. */
  readonly onAskLangyToSetUp?: (missing: { field: string; label: string }) => void;
  /** Told which face the frame draws, so the card offers only what that face allows. */
  readonly onFaceChange?: (face: WidgetFace["kind"]) => void;
  /** Told the messages of what the server limited in the run, joined; "" when it limited none. */
  readonly onLimitsChange?: (limits: string) => void;
  /** Handed what "Export CSV" would write now: the rows the widget's queries last returned. */
  readonly onExportChange?: (widgetExport: WidgetExport) => void;
  /** Told whether the card shows none of the widget's data, so a board can offer to set it up. */
  readonly onEmptyChange?: (empty: boolean) => void;
};

/**
 * A widget over a window its caller owns. A new SQL statement or sources list starts it over, so
 * no answer to an earlier query stays on the card; the period and grain re-run it in place
 * through the dashboard context (dashboards-v2 AC201d).
 */
export function DashboardWidgetFrameOverWindow(props: DashboardWidgetFrameOverWindowProps) {
  const parsed = dashboardWidgetDefinitionSchema.safeParse(props.graph);
  const queries = parsed.success ? JSON.stringify(parsed.data.queries) : "";
  return <WidgetFrameOverWindow key={`${props.id}:${queries}`} {...props} parsed={parsed} />;
}

/** The outcome of reading a row's graph, parsed once by the caller. */
type ParsedDefinition = ReturnType<typeof dashboardWidgetDefinitionSchema.safeParse>;

/**
 * `granularitySeconds`, when given, is the step the reserved parameters carry.
 * What its queries report decides its face (features/dashboards/WIDGET_STANDARD.md).
 */
function WidgetFrameOverWindow({
  id,
  projectId,
  projectSlug,
  maxHeight,
  dashboardId,
  widgetName,
  timeWindow,
  granularitySeconds,
  onAskLangyToSetUp,
  onFaceChange,
  onLimitsChange,
  onExportChange,
  onEmptyChange,
  parsed,
}: DashboardWidgetFrameOverWindowProps & { readonly parsed: ParsedDefinition }) {
  const { colorMode } = useColorMode();
  const refreshedAt = useDashboardRefreshedAt();
  const onNavigate = useDashboardWidgetChartNavigate(projectSlug);

  // A row this build never wrote — an old shape, a hand-edited one — fails
  // safeParse and degrades to an empty file with no queries rather than
  // crashing the grid.
  const definition = parsed.success ? parsed.data : { code: "", queries: [] };

  const source = parsed.success ? parsed.data.source : void 0;
  const templateId = source?.kind === "catalogue" ? source.catalogueId : void 0;
  // Kept by value, so a re-render with the same ids does not start the queries over.
  const telemetry = useMemo(
    () =>
      dashboardId === void 0
        ? void 0
        : { dashboardId, widgetId: id, ...(templateId === void 0 ? {} : { templateId }) },
    [dashboardId, id, templateId],
  );
  const {
    executeQuery: runQuery,
    params: hostParams,
    limits,
  } = useDashboardWidgetExecutor(projectId, definition.queries, {
    timeWindow,
    ...(granularitySeconds === void 0 ? {} : { granularitySeconds }),
    ...(telemetry ? { telemetry } : {}),
  });
  const { executeQuery, records, results, reset } = useWidgetQueryRecords({
    executeQuery: runQuery,
    timeWindow,
  });
  const face = useMemo(() => widgetFace(records), [records]);
  usePublishWidgetCompleteness(face.kind === "chart" ? face.completeness : null);
  useEffect(() => onFaceChange?.(face.kind), [onFaceChange, face.kind]);
  const limitsLine = limits.join(" · ");
  useEffect(() => onLimitsChange?.(limitsLine), [onLimitsChange, limitsLine]);

  const hasQueries = definition.queries.length > 0;
  const widgetExport = useMemo(
    () => ({ status: widgetExportStatus({ face: face.kind, hasQueries, results }), results }),
    [face.kind, hasQueries, results],
  );
  useEffect(() => onExportChange?.(widgetExport), [onExportChange, widgetExport]);
  const empty = widgetShowsNoData({ face: face.kind, status: widgetExport.status });
  useEffect(() => onEmptyChange?.(empty), [onEmptyChange, empty]);

  // The frame's own word: its code mounted with no query open, such as a query behind a tab.
  const [frameIdle, setFrameIdle] = useState(false);

  // Retry starts the frame over, so every query of the widget runs again.
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => {
    reset();
    setFrameIdle(false);
    setAttempt((n) => n + 1);
  }, [reset]);

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
  const { diagnostic, fatal, onLog } = useFrameDiagnostic({
    resetKey: `${definition.code}:${attempt}`,
  });
  // Until a query answers the frame has nothing to draw; code that crashed never will.
  const loading = hasQueries && !fatal && !frameIdle && awaitsFirstAnswer(records);
  const slow = useSlowLoading({ isLoading: loading });

  if (!parsed.success) {
    return (
      <Text textStyle="bodySm" color="fg.muted" padding={4}>
        This widget&apos;s definition could not be read.
      </Text>
    );
  }

  const cover = faceInPlaceOfChart({
    face,
    name: widgetName ?? "this widget",
    onRetry: retry,
    onAskLangyToSetUp,
    onSetUp: (target) => onNavigate({ target, params: {} }),
  });

  // The frame stays mounted under a face, so a new period can bring the chart back.
  return (
    <Box position="relative" height="full">
      <Box visibility={cover ? "hidden" : "visible"} aria-hidden={cover ? true : undefined}>
        <SandboxedChartFrame
          key={`${id}:${attempt}`}
          code={definition.code}
          executeQuery={executeQuery}
          dashboardContext={dashboardContext}
          params={paramsSnapshot}
          onLog={onLog}
          onNavigate={onNavigate}
          maxHeight={maxHeight}
          cover={loading && !cover ? <WidgetLoadingFace slow={slow} /> : undefined}
          onIdleChange={setFrameIdle}
        />
      </Box>
      {cover && (
        <Box position="absolute" inset={0} data-testid="widget-state-face">
          {cover}
        </Box>
      )}
      <FrameDiagnosticBadge diagnostic={diagnostic} />
    </Box>
  );
}

/** The face drawn over the frame, or null when the widget's own code draws the card. */
function faceInPlaceOfChart({
  face,
  name,
  onRetry,
  onAskLangyToSetUp,
  onSetUp,
}: {
  face: WidgetFace;
  name: string;
  onRetry: () => void;
  onAskLangyToSetUp?: (missing: { field: string; label: string }) => void;
  onSetUp: (target: NavigableTarget) => void;
}) {
  switch (face.kind) {
    case "no_access":
      return <NoAccessFace missingGates={face.missingGates} />;
    case "failed":
      return <WidgetFailedFace name={name} message={face.error.message} onRetry={onRetry} />;
    case "no_traffic":
      return <NoTrafficFace unit={face.unit} onSetUp={onSetUp} />;
    case "missing":
      return (
        <WidgetSetupFace
          label={face.missing.label}
          unit={face.unit}
          guidance={missingFieldGuidance({ ...face.missing, unit: face.unit })}
          onAskLangy={onAskLangyToSetUp && (() => onAskLangyToSetUp(face.missing))}
        />
      );
    case "chart":
      return null;
  }
}

/** No traffic, with what sends it; a setup step only where the project awaits its first trace. */
function NoTrafficFace({
  unit,
  onSetUp,
}: {
  unit: string;
  onSetUp: (target: NavigableTarget) => void;
}) {
  const awaitsFirstTrace = projectAwaitsFirstTrace(useAnalyticsHost().project());
  const guidance = noTrafficGuidance({ unit, awaitsFirstTrace });
  const action = guidance?.action;
  return (
    <WidgetNoTrafficFace
      unit={unit}
      guidance={guidance?.line}
      onSetUp={action && { label: action.label, onClick: () => onSetUp(action.target) }}
    />
  );
}

/** The no-access state in the words for the project the reader is in. */
function NoAccessFace({ missingGates }: { missingGates: readonly string[] }) {
  const projectName = useAnalyticsHost().project()?.name;
  return <WidgetNoAccessFace {...withheldWords({ missingGates, projectName })} />;
}
