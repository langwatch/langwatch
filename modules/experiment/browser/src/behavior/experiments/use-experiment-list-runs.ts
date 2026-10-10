import { useEffect, useRef } from "react";

import { experimentApi } from "../experiment-api.ts";

/** Every run of one list row: cost, status and every evaluator's value, without the run's items. */
export function useExperimentListRuns({
  projectId,
  experimentId,
  enabled,
}: {
  projectId: string;
  experimentId: string;
  enabled: boolean;
}) {
  return experimentApi.experiments.getExperimentBatchEvaluationRuns.useQuery(
    { projectId, experimentId },
    { enabled, refetchOnWindowFocus: false },
  );
}

/** One run with its items, fetched when a row is opened: the per-target numbers come from it. */
export function useExperimentRunItems({
  projectId,
  experimentId,
  runId,
  enabled,
}: {
  projectId: string;
  experimentId: string;
  runId: string | undefined;
  enabled: boolean;
}) {
  return experimentApi.experiments.getExperimentBatchEvaluationRun.useQuery(
    { projectId, experimentId, runId: runId ?? "" },
    { enabled: enabled && !!runId, refetchOnWindowFocus: false },
  );
}

/**
 * Refetches an open row's runs once per change the list reports (its run count or newest run),
 * so a panel never keeps showing runs the list has moved past.
 */
export function useRefetchWhenStale({
  active,
  stamp,
  refetch,
}: {
  /** The row is open and its cached runs no longer match the list. */
  active: boolean;
  /** Identifies what the list says now: refetches once per distinct stamp. */
  stamp: string;
  refetch: () => unknown;
}) {
  const refetched = useRef<string | undefined>(undefined);
  const latest = useRef(refetch);
  latest.current = refetch;
  useEffect(() => {
    if (!active || refetched.current === stamp) return;
    refetched.current = stamp;
    void latest.current();
  }, [active, stamp]);
}
