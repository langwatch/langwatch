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
import { useCallback, useMemo, useState } from "react";

import { analyticsApi } from "../../../behavior/analytics-api.ts";
import type { ChartFrameExecuteQuery } from "../../../behavior/frame-bridge.ts";
import { createLangWatchQLExecute } from "../../../behavior/lwql-execute.ts";
import type { LangWatchQLParameterValue } from "../../../model/lwql-request-state.ts";

/** The diagnostics that say the server limited a run, shown on the card as one (i) line. */
const LIMIT_DIAGNOSTIC_CODES: readonly string[] = [
  "SHARE_WINDOW_LIMITED",
  "SOURCES_IGNORED",
  "GRANULARITY_COARSENED",
];

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
  const telemetry = overrides?.telemetry;
  const execute = useMemo(
    () =>
      createLangWatchQLExecute({
        transport: {
          mutate: (input, options) => utils.client.analytics.lwql.query.mutate(input, options),
        },
        projectId,
      }),
    [utils, projectId],
  );
  const [lastRuns, setLastRuns] = useState<Record<string, QueryLastRun>>({});

  // What the server limited, per statement: the (i) line a card shows (dashboards-v2 AC213).
  const [limitsBySql, setLimitsBySql] = useState<Record<string, readonly string[]>>({});
  const noteLimits = useCallback(
    ({ query, result }: { query: string; result: LangWatchQLQueryResult }) => {
      const messages = result.diagnostics
        .filter(({ code }) => LIMIT_DIAGNOSTIC_CODES.includes(code))
        .map(({ message }) => message);
      setLimitsBySql((prev) =>
        prev[query]?.join() === messages.join() ? prev : { ...prev, [query]: messages },
      );
    },
    [],
  );
  const limits = useMemo(() => [...new Set(Object.values(limitsBySql).flat())], [limitsBySql]);

  const recordRun = useCallback((name: string, run: QueryLastRun) => {
    setLastRuns((prev) => ({ ...prev, [name]: run }));
  }, []);

  const runValidated = useCallback(
    async (
      query: Pick<DashboardWidgetQuery, "sql" | "sources" | "projects">,
      params: Readonly<Record<string, LangWatchQLParameterValue>>,
      signal?: AbortSignal,
    ): Promise<ChartQueryResult> => {
      const result = await execute(
        {
          sql: query.sql,
          parameters: params,
          timeWindow: pageWindow,
          granularitySeconds,
          // What the query stores; null asks the server for the default (dashboards-v2 AC200f).
          sources: query.sources ?? null,
          ...(query.projects ? { projects: query.projects } : {}),
          telemetry,
        },
        // `execute` requires a signal; callers without one (e.g. `runStandalone`)
        // get a fresh controller's signal, which simply never aborts.
        { signal: signal ?? new AbortController().signal },
      );
      noteLimits({ query: query.sql, result });
      return toChartQueryResult(result);
    },
    [execute, pageWindow, granularitySeconds, noteLimits, telemetry],
  );

  const executeQuery: ChartFrameExecuteQuery = useCallback(
    async ({ queryName, params, signal }) => {
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
    },
    [queries, recordRun, runValidated],
  );

  /**
   * Fills every declared parameter from its default, so a required
   * parameter with no default simply fails validation — the same outcome
   * a disabled button would express, through the one validation path.
   */
  const runStandalone = useCallback(
    async (query: DashboardWidgetQuery) => {
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
    },
    [recordRun, runValidated],
  );

  const params: Pick<ChartFrameDashboardContext, "timeWindow" | "granularitySeconds"> = useMemo(
    () => ({
      timeWindow: { start: pageWindow.start, end: pageWindow.end },
      granularitySeconds,
    }),
    [pageWindow, granularitySeconds],
  );

  return { executeQuery, runStandalone, params, lastRuns, limits };
}
