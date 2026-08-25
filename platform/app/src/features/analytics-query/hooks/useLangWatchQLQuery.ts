/**
 * The workbench's request state, bound to React.
 *
 * A thin wrapper: the machine is `../logic/lwqlRequestController`, and
 * everything this adds is lifecycle — one controller per mount, a subscription,
 * and a disposal that aborts whatever is in flight.
 *
 * @see packages/features/analytics/specs/analytics-lwql-workbench.feature
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { api } from "~/utils/api";

import { createLangWatchQLExecute } from "../logic/lwqlExecute";
import {
  createLangWatchQLRequestController,
  type LangWatchQLRequestController,
} from "../logic/lwqlRequestController";
import {
  isLangWatchQLResultStale,
  type LangWatchQLActionLabel,
  type LangWatchQLParameterValue,
  type LangWatchQLRequestState,
  type LangWatchQLTimeWindowValues,
  lwqlActionLabel,
} from "../logic/lwqlRequestState";

export interface UseLangWatchQLQuery {
  state: LangWatchQLRequestState;
  /** Whether the visible outcome belongs to a superseded draft. */
  isStale: boolean;
  /** What the primary action reads right now. */
  actionLabel: LangWatchQLActionLabel;
  setSql: (sql: string) => void;
  setParameters: (
    parameters: Readonly<Record<string, LangWatchQLParameterValue>>,
  ) => void;
  /** Sets the period the next submission reports over, or clears it. */
  setTimeWindow: (timeWindow: LangWatchQLTimeWindowValues | undefined) => void;
  /** Submits the current draft. Ignored while a request is in flight. */
  runQuery: () => void;
  /** Re-sends the submitted snapshot, never the draft. */
  reload: () => void;
  /** Abandons the in-flight request, keeping the previous result on screen. */
  cancelQuery: () => void;
}

export function useLangWatchQLQuery({
  projectId,
}: {
  projectId: string;
}): UseLangWatchQLQuery {
  const utils = api.useUtils();

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
    (timeWindow: LangWatchQLTimeWindowValues | undefined) =>
      controller.setTimeWindow(timeWindow),
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
    runQuery,
    reload,
    cancelQuery,
  };
}
