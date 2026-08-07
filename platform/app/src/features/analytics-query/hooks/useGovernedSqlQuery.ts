/**
 * The workbench's request state, bound to React.
 *
 * A thin wrapper: the machine is `../logic/governedSqlRequestController`, and
 * everything this adds is lifecycle — one controller per mount, a subscription,
 * and a disposal that aborts whatever is in flight.
 *
 * @see specs/analytics/governed-sql-workbench.feature
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { api } from "~/utils/api";

import { createGovernedSqlExecute } from "../logic/governedSqlExecute";
import {
  createGovernedSqlRequestController,
  type GovernedSqlRequestController,
} from "../logic/governedSqlRequestController";
import {
  type GovernedSqlActionLabel,
  type GovernedSqlParameterValue,
  type GovernedSqlRequestState,
  governedSqlActionLabel,
  isGovernedSqlResultStale,
} from "../logic/governedSqlRequestState";

export interface UseGovernedSqlQuery {
  state: GovernedSqlRequestState;
  /** Whether the visible outcome belongs to a superseded draft. */
  isStale: boolean;
  /** What the primary action reads right now. */
  actionLabel: GovernedSqlActionLabel;
  setSql: (sql: string) => void;
  setParameters: (
    parameters: Readonly<Record<string, GovernedSqlParameterValue>>,
  ) => void;
  /** Submits the current draft. Ignored while a request is in flight. */
  runQuery: () => void;
  /** Re-sends the submitted snapshot, never the draft. */
  reload: () => void;
  /** Abandons the in-flight request, keeping the previous result on screen. */
  cancelQuery: () => void;
}

export function useGovernedSqlQuery({
  projectId,
}: {
  projectId: string;
}): UseGovernedSqlQuery {
  const utils = api.useUtils();

  // Read through refs so the controller survives every re-render: rebuilding it
  // would throw away the draft the member is in the middle of writing.
  const utilsRef = useRef(utils);
  utilsRef.current = utils;
  const projectIdRef = useRef(projectId);
  projectIdRef.current = projectId;

  const [controller] = useState<GovernedSqlRequestController>(() =>
    createGovernedSqlRequestController({
      execute: (request, options) =>
        createGovernedSqlExecute({
          utils: utilsRef.current,
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

  const setSql = useCallback(
    (sql: string) => controller.setSql(sql),
    [controller],
  );
  const setParameters = useCallback(
    (parameters: Readonly<Record<string, GovernedSqlParameterValue>>) =>
      controller.setParameters(parameters),
    [controller],
  );
  const runQuery = useCallback(() => controller.runQuery(), [controller]);
  const reload = useCallback(() => controller.reload(), [controller]);
  const cancelQuery = useCallback(() => controller.cancel(), [controller]);

  return {
    state,
    isStale: isGovernedSqlResultStale(state),
    actionLabel: governedSqlActionLabel(state),
    setSql,
    setParameters,
    runQuery,
    reload,
    cancelQuery,
  };
}
