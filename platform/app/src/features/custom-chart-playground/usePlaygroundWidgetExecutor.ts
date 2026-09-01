/**
 * Runs a playground widget's queries against the real LangWatchQL endpoint.
 *
 * Two entry points, one validation gate (`validatePlaygroundQueryParams`) and
 * one underlying `execute` call, so a query can never validate or run
 * differently depending on which one invoked it:
 *
 *  - `executeQuery` — the bridge-facing `(queryName, params, signal)` the live
 *    Chart view calls on `LW.query`. Resolves `queryName` against whatever
 *    `queries` the card passes in — the card's own debounced preview of the
 *    drawer's draft, so a query edit reaches the running chart the same
 *    "settles, then re-mounts" way a code edit does, never mid-keystroke.
 *  - `runStandalone` — the drawer's Queries tab "Run" button. Takes whatever
 *    query object the caller hands it (the tab's current, un-debounced draft
 *    row, so a SQL edit can be tried the instant it's typed) and runs it
 *    without touching the chart at all.
 *
 * Every run — live or standalone, success or validation/execution failure —
 * is recorded into `lastRuns` keyed by query name, which is what lets the
 * Queries tab show "the last result" regardless of which path produced it.
 */

import { useCallback, useMemo, useState } from "react";

import { createLangWatchQLExecute } from "~/features/analytics-query/logic/lwqlExecute";
import { explainAnyError, readHandledError } from "~/features/errors";
import type { LangWatchQLGranularityStep } from "~/server/analytics/lwql/timeWindow";
import {
  type PlaygroundQuery,
  validatePlaygroundQueryParams,
} from "~/server/analytics/playgroundWidgetDefinition";
import { api } from "~/utils/api";

import type {
  ChartFrameParams,
  ChartQueryError,
  ChartQueryResult,
} from "./bridge/bridgeProtocol";
import { toChartQueryResult } from "./bridge/bridgeProtocol";
import type { ChartFrameExecuteQuery } from "./bridge/frameBridge";

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

export function usePlaygroundWidgetExecutor(
  projectId: string,
  queries: PlaygroundQuery[],
) {
  const utils = api.useUtils();
  const [pageWindow] = useState<{ start: number; end: number }>(() => {
    const end = Date.now();
    return { start: end - 24 * 60 * 60 * 1000, end };
  });
  const execute = useMemo(
    () => createLangWatchQLExecute({ utils, projectId }),
    [utils, projectId],
  );
  const [lastRuns, setLastRuns] = useState<Record<string, QueryLastRun>>({});

  const recordRun = useCallback((name: string, run: QueryLastRun) => {
    setLastRuns((prev) => ({ ...prev, [name]: run }));
  }, []);

  const runValidated = useCallback(
    async (
      query: Pick<PlaygroundQuery, "sql">,
      params: Readonly<Record<string, unknown>>,
      signal?: AbortSignal,
    ): Promise<ChartQueryResult> => {
      const result = await execute(
        {
          sql: query.sql,
          parameters: params,
          timeWindow: pageWindow,
          granularitySeconds: DEFAULT_GRANULARITY,
        },
        { signal },
      );
      return toChartQueryResult(result);
    },
    [execute, pageWindow],
  );

  const executeQuery: ChartFrameExecuteQuery = useCallback(
    async (queryName, params, signal) => {
      const query = queries.find((q) => q.name === queryName);
      if (!query) {
        const error: ChartQueryError = {
          code: "playground_query_not_found",
          title: "Unknown query",
          message: `This widget has no query named "${queryName}".`,
        };
        recordRun(queryName, { ranAt: Date.now(), error });
        throw error;
      }
      const validation = validatePlaygroundQueryParams(query, params);
      if (!validation.ok) {
        recordRun(queryName, { ranAt: Date.now(), error: validation.error });
        throw validation.error;
      }
      try {
        const result = await runValidated(query, validation.params, signal);
        recordRun(queryName, { ranAt: Date.now(), result });
        return result;
      } catch (error) {
        const shaped = toChartQueryError(error);
        recordRun(queryName, { ranAt: Date.now(), error: shaped });
        throw shaped;
      }
    },
    [queries, recordRun, runValidated],
  );

  /**
   * Fills every declared parameter from its default (there is no other
   * source of a value here), so a required parameter with no default simply
   * fails validation — the same "cannot run standalone without one" outcome
   * a disabled button would express, reached through the one validation path
   * instead of a second rule to keep in sync with it.
   */
  const runStandalone = useCallback(
    async (query: PlaygroundQuery) => {
      const validation = validatePlaygroundQueryParams(query, {});
      if (!validation.ok) {
        recordRun(query.name, { ranAt: Date.now(), error: validation.error });
        return;
      }
      try {
        const result = await runValidated(query, validation.params);
        recordRun(query.name, { ranAt: Date.now(), result });
      } catch (error) {
        recordRun(query.name, {
          ranAt: Date.now(),
          error: toChartQueryError(error),
        });
      }
    },
    [recordRun, runValidated],
  );

  const params: ChartFrameParams = useMemo(
    () => ({
      timeWindow: { start: pageWindow.start, end: pageWindow.end },
      granularitySeconds: DEFAULT_GRANULARITY,
    }),
    [pageWindow],
  );

  return { executeQuery, runStandalone, params, lastRuns };
}
