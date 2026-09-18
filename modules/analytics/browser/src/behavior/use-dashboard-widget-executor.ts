/**
 * Runs dashboard widget queries against the real LangWatchQL endpoint.
 * `executeQuery` (the live chart) and `runStandalone` (the drawer's Run
 * button) share one validation gate, so a query runs identically either way.
 */

import type { LangWatchQLGranularityStep } from "@langwatch/analytics-contract";
import { explainAnyError } from "@langwatch/error-presentation/presentation";
import { nowInstant } from "@langwatch/time";
import { useCallback, useMemo, useState } from "react";

import {
  type DashboardWidgetQuery,
  validateDashboardWidgetQueryParams,
} from "../model/dashboard-widget-definition.ts";
import type {
  ChartFrameDashboardContext,
  ChartQueryError,
  ChartQueryResult,
} from "../model/dashboard-widget/bridge-protocol.ts";
import { toChartQueryResult } from "../model/dashboard-widget/bridge-protocol.ts";
import { readHandledError } from "../model/handled-error.ts";
import type { LangWatchQLParameterValue } from "../model/lwql-request-state.ts";
import { analyticsApi } from "./analytics-api.ts";
import type { ChartFrameExecuteQuery } from "./frame-bridge.ts";
import { createLangWatchQLExecute } from "./lwql-execute.ts";

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
  return {
    code: readHandledError(error)?.code ?? "unknown",
    title: explained.title,
    message: explained.description,
  };
}

export interface DashboardWidgetExecutorOverrides {
  /** Replaces the "last 24 hours from mount" default — the dashboard's own period. */
  readonly timeWindow?: { start: number; end: number };
  /** Replaces {@link DEFAULT_GRANULARITY} — the dashboard's own step. */
  readonly granularitySeconds?: LangWatchQLGranularityStep;
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
  const granularitySeconds = overrides?.granularitySeconds ?? DEFAULT_GRANULARITY;
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

  const recordRun = useCallback((name: string, run: QueryLastRun) => {
    setLastRuns((prev) => ({ ...prev, [name]: run }));
  }, []);

  const runValidated = useCallback(
    async (
      query: Pick<DashboardWidgetQuery, "sql">,
      params: Readonly<Record<string, LangWatchQLParameterValue>>,
      signal?: AbortSignal,
    ): Promise<ChartQueryResult> => {
      const result = await execute(
        {
          sql: query.sql,
          parameters: params,
          timeWindow: pageWindow,
          granularitySeconds,
        },
        // `execute` requires a signal; callers without one (e.g. `runStandalone`)
        // get a fresh controller's signal, which simply never aborts.
        { signal: signal ?? new AbortController().signal },
      );
      return toChartQueryResult(result);
    },
    [execute, pageWindow, granularitySeconds],
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

  return { executeQuery, runStandalone, params, lastRuns };
}
