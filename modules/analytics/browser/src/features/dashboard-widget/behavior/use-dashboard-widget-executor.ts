/**
 * Runs dashboard widget queries against the real LangWatchQL endpoint.
 * `executeQuery` (the live chart) and `runStandalone` (the drawer's Run
 * button) share one validation gate, so a query runs identically either way.
 */

import {
  findLangWatchQLMissingGates,
  type LangWatchQLAcceptedGranularityStep,
  type LangWatchQLGranularityStep,
  type LangWatchQLQueryResult,
  type LangWatchQLRunTelemetryRequest,
} from "@langwatch/analytics-contract";
import type {
  ChartFrameDashboardContext,
  ChartQueryError,
  ChartQueryResult,
} from "@langwatch/analytics-contract/chart-frame-protocol";
import { toChartQueryResult } from "@langwatch/analytics-contract/chart-frame-protocol";
import {
  type DashboardWidgetQuery,
  validateDashboardWidgetQueryParams,
} from "@langwatch/analytics-contract/dashboard-widget-definition";
import { explainAnyError } from "@langwatch/handled-error/presentation";
import { readHandledError } from "@langwatch/handled-error/read-handled-error";
import { nowInstant } from "@langwatch/time";
import { createContext, useContext, useState } from "react";

import { analyticsApi } from "../../../behavior/analytics-api.ts";
import type { ChartFrameExecuteQuery } from "../../../behavior/frame-bridge.ts";
import { createLangWatchQLExecute } from "../../../behavior/lwql-execute.ts";
import type { LangWatchQLParameterValue } from "../../../model/lwql-request-state.ts";
import { runSources } from "../../dashboards/model/widget-sources.ts";

/**
 * The diagnostics that say the server limited a run, shown on the card as one (i) line.
 * SOURCES_IGNORED is left to the sources line: its text is for the query's author.
 */
const LIMIT_DIAGNOSTIC_CODES: readonly string[] = ["SHARE_WINDOW_LIMITED", "GRANULARITY_COARSENED"];

/** The messages a card's (i) line shows for one run's diagnostics (dashboards-v2 AC213). */
export function cardLimitMessages(
  diagnostics: readonly { code: string; message: string }[],
): string[] {
  return diagnostics
    .filter(({ code }) => LIMIT_DIAGNOSTIC_CODES.includes(code))
    .map(({ message }) => message);
}

/**
 * Whether a widget naming no projects reads every project the member may read, not the bound
 * one: true on a Gateway or Governance board, which reads the organization (ADR-002, D2).
 */
export const WidgetReadsEveryProjectContext = createContext(false);

/** Widgets run against the last 24 hours at an hourly step — no toolbar. */
const DEFAULT_GRANULARITY: LangWatchQLGranularityStep = 3600;

export interface QueryLastRun {
  readonly ranAt: number;
  readonly result?: ChartQueryResult;
  readonly error?: ChartQueryError;
}

/** Maps whatever `execute` throws to the same shape a declared-param rejection carries. */
function toChartQueryError(error: unknown): ChartQueryError {
  // ADR-045: registry copy only, with the lwql_* code riding along.
  const explained = explainAnyError(error);
  const handled = readHandledError(error);
  // A refusal about what the reader may see, not about the query: the card says so.
  const missingGates =
    handled?.code === "lwql_not_permitted"
      ? findLangWatchQLMissingGates(handled.meta.violations)
      : [];
  return {
    code: handled?.code ?? "unknown",
    title: explained.title,
    message: explained.description,
    ...(handled?.retryable === true ? { retryable: true } : {}),
    ...(missingGates.length > 0 ? { missingGates } : {}),
  };
}

export interface DashboardWidgetExecutorOverrides {
  /** Replaces the "last 24 hours from mount" default — the dashboard's own period. */
  readonly timeWindow?: { start: number; end: number };
  /** Replaces {@link DEFAULT_GRANULARITY} — the dashboard's own step. */
  readonly granularitySeconds?: LangWatchQLAcceptedGranularityStep;
  /** The placed widget its runs are for, for their log line; absent in the editor's preview. */
  readonly telemetry?: LangWatchQLRunTelemetryRequest;
}

/** The ids a widget's runs are logged under, apart, so a hook can depend on them by value. */
function telemetryIdsOf(
  overrides: DashboardWidgetExecutorOverrides | undefined,
): Partial<LangWatchQLRunTelemetryRequest> {
  return overrides?.telemetry ?? {};
}

/** The ids put back together for the request; none when the run is no placed widget's. */
function runTelemetryOf({
  dashboardId,
  widgetId,
  templateId,
}: Partial<LangWatchQLRunTelemetryRequest>): LangWatchQLRunTelemetryRequest | undefined {
  if (widgetId === void 0) return void 0;
  return {
    widgetId,
    ...(dashboardId === void 0 ? {} : { dashboardId }),
    ...(templateId === void 0 ? {} : { templateId }),
  };
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: splits would scatter closured state.
export function useDashboardWidgetExecutor(
  projectId: string,
  queries: DashboardWidgetQuery[],
  overrides?: DashboardWidgetExecutorOverrides,
) {
  const utils = analyticsApi.useUtils();
  // The playground editor has no period control, so it defaults to a fixed
  // window computed once at mount; a dashboard card passes its own via
  // `overrides.timeWindow` instead, tracking the grid's period control.
  const [mountWindow] = useState<{ start: number; end: number }>(() => {
    const end = nowInstant().epochMilliseconds;
    return { start: end - 24 * 60 * 60 * 1000, end };
  });
  const pageWindow = overrides?.timeWindow ?? mountWindow;
  const granularitySeconds: LangWatchQLAcceptedGranularityStep =
    overrides?.granularitySeconds ?? DEFAULT_GRANULARITY;
  // By value, not by object: a caller that builds the ids afresh each render keeps one run.
  const { dashboardId, widgetId, templateId } = telemetryIdsOf(overrides);
  const readsEveryProject = useContext(WidgetReadsEveryProjectContext);
  const execute = createLangWatchQLExecute({
    transport: {
      mutate: (input, options) => utils.client.analytics.lwql.query.mutate(input, options),
    },
    projectId,
    readsEveryProject,
  });
  const [lastRuns, setLastRuns] = useState<Record<string, QueryLastRun>>({});

  // What the server limited, per statement: the (i) line a card shows (dashboards-v2 AC213).
  const [limitsBySql, setLimitsBySql] = useState<Record<string, readonly string[]>>({});
  const noteLimits = ({ query, result }: { query: string; result: LangWatchQLQueryResult }) => {
    const messages = cardLimitMessages(result.diagnostics);
    setLimitsBySql((prev) =>
      prev[query]?.join() === messages.join() ? prev : { ...prev, [query]: messages },
    );
  };
  const limits = [...new Set(Object.values(limitsBySql).flat())];

  const recordRun = (name: string, run: QueryLastRun) => {
    setLastRuns((prev) => ({ ...prev, [name]: run }));
  };

  const runValidated = async (
    query: Pick<DashboardWidgetQuery, "name" | "sql" | "sources" | "projects">,
    params: Readonly<Record<string, LangWatchQLParameterValue>>,
    signal?: AbortSignal,
  ): Promise<ChartQueryResult> => {
    const result = await execute(
      {
        sql: query.sql,
        parameters: params,
        timeWindow: pageWindow,
        granularitySeconds,
        sources: runSources(query),
        ...(query.projects ? { projects: query.projects } : {}),
        telemetry: runTelemetryOf({ dashboardId, widgetId, templateId }),
      },
      // `execute` requires a signal; callers without one (e.g. `runStandalone`)
      // get a fresh controller's signal, which simply never aborts.
      { signal: signal ?? new AbortController().signal },
    );
    noteLimits({ query: query.sql, result });
    return toChartQueryResult(result);
  };

  const executeQuery: ChartFrameExecuteQuery = async ({ queryName, params, signal }) => {
    const query = queries.find((q) => q.name === queryName);
    if (!query) {
      const error: ChartQueryError = {
        code: "dashboard_widget_query_not_found",
        title: "Unknown query",
        message: `This widget has no query named "${queryName}".`,
      };
      recordRun(queryName, { ranAt: nowInstant().epochMilliseconds, error });
      throw error;
    }
    const validation = validateDashboardWidgetQueryParams({ query, params });
    if (!validation.ok) {
      recordRun(queryName, { ranAt: nowInstant().epochMilliseconds, error: validation.error });
      throw validation.error;
    }
    try {
      const result = await runValidated(query, validation.params, signal);
      recordRun(queryName, { ranAt: nowInstant().epochMilliseconds, result });
      return result;
    } catch (error) {
      const shaped = toChartQueryError(error);
      recordRun(queryName, { ranAt: nowInstant().epochMilliseconds, error: shaped });
      throw shaped;
    }
  };

  /**
   * Fills every declared parameter from its default, so a required
   * parameter with no default simply fails validation — the same outcome
   * a disabled button would express, through the one validation path.
   */
  const runStandalone = async (query: DashboardWidgetQuery) => {
    const validation = validateDashboardWidgetQueryParams({
      query,
      params: {},
    });
    if (!validation.ok) {
      recordRun(query.name, { ranAt: nowInstant().epochMilliseconds, error: validation.error });
      return;
    }
    try {
      const result = await runValidated(query, validation.params);
      recordRun(query.name, { ranAt: nowInstant().epochMilliseconds, result });
    } catch (error) {
      recordRun(query.name, {
        ranAt: nowInstant().epochMilliseconds,
        error: toChartQueryError(error),
      });
    }
  };

  const params: Pick<ChartFrameDashboardContext, "timeWindow" | "granularitySeconds"> = {
    timeWindow: { start: pageWindow.start, end: pageWindow.end },
    granularitySeconds,
  };

  return { executeQuery, runStandalone, params, lastRuns, limits };
}
