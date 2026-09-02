/**
 * The workbench's request state, bound to React.
 *
 * A thin application binding around the Analytics package request machine.
 * This adds one controller per mount, a subscription, and disposal that aborts
 * whatever is in flight.
 *
 * @see packages/features/analytics/specs/analytics-lwql-workbench.feature
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import type { LangWatchQLGranularityStep } from "@langwatch/analytics-contract";
import { analyticsApi } from "./analytics-api";

import { createLangWatchQLExecute } from "./lwql-execute";
import {
  createLangWatchQLRequestController,
  type LangWatchQLRequestController,
} from "../model/lwql-request-controller";
import {
  isLangWatchQLResultStale,
  type LangWatchQLActionLabel,
  type LangWatchQLParameterValue,
  type LangWatchQLRequestState,
  type LangWatchQLTimeWindowValues,
  lwqlActionLabel,
} from "../model/lwql-request-state";

export interface UseLangWatchQLQuery {
  state: LangWatchQLRequestState;
  /** Whether the visible outcome belongs to a superseded draft. */
  isStale: boolean;
  /** What the primary action reads right now. */
  actionLabel: LangWatchQLActionLabel;
  setSql: (sql: string) => void;
  setParameters: (parameters: Readonly<Record<string, LangWatchQLParameterValue>>) => void;
  /** Sets the period the next submission reports over, or clears it. */
  setTimeWindow: (timeWindow: LangWatchQLTimeWindowValues | undefined) => void;
  /** Sets the step the next submission buckets at, or clears it. */
  setGranularity: (granularitySeconds: LangWatchQLGranularityStep | undefined) => void;
  /** Submits the current draft. Ignored while a request is in flight. */
  runQuery: () => void;
  /** Re-sends the submitted snapshot, never the draft. */
  reload: () => void;
  /** Abandons the in-flight request, keeping the previous result on screen. */
  cancelQuery: () => void;
}

export function useLangWatchQLQuery({ projectId }: { projectId: string }): UseLangWatchQLQuery {
  const utils = analyticsApi.useUtils();

  // Read through refs so the controller survives every re-render: rebuilding it
  // would throw away the draft the member is in the middle of writing.
  const utilsRef = useRef(utils);
  utilsRef.current = utils;
  const projectIdRef = useRef(projectId);
  projectIdRef.current = projectId;

  const [controller] = useState<LangWatchQLRequestController>(() =>
    createLangWatchQLRequestController({
      execute: (request, options) =>
        createLangWatchQLExecute({
          transport: {
            mutate: (input, options) =>
              utilsRef.current.client.analytics.lwql.query.mutate(input, options),
          },
          projectId: projectIdRef.current,
        })(request, options),
    }),
  );

  useEffect(() => () => controller.dispose(), [controller]);

  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getState,
    controller.getState,
  );

  const setSql = useCallback((sql: string) => controller.setSql(sql), [controller]);
  const setParameters = useCallback(
    (parameters: Readonly<Record<string, LangWatchQLParameterValue>>) =>
      controller.setParameters(parameters),
    [controller],
  );
  const setTimeWindow = useCallback(
    (timeWindow: LangWatchQLTimeWindowValues | undefined) => controller.setTimeWindow(timeWindow),
    [controller],
  );
  const setGranularity = useCallback(
    (granularitySeconds: LangWatchQLGranularityStep | undefined) =>
      controller.setGranularity(granularitySeconds),
    [controller],
  );
  const runQuery = useCallback(() => controller.runQuery(), [controller]);
  const reload = useCallback(() => controller.reload(), [controller]);
  const cancelQuery = useCallback(() => controller.cancel(), [controller]);

  return {
    state,
    isStale: isLangWatchQLResultStale(state),
    actionLabel: lwqlActionLabel(state),
    setSql,
    setParameters,
    setTimeWindow,
    setGranularity,
    runQuery,
    reload,
    cancelQuery,
  };
}
