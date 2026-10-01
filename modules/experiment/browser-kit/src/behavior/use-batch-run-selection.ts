/** The selected batch run, whether it finished, and how often to poll. Consumers fetch. */
import type { ExperimentRun } from "@langwatch/experiment-contract";
import { nowInstant, toEpochMs } from "@langwatch/time";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/** A run without a finish stamp counts as finished once it has been silent for two minutes. */
function getFinishedAt(timestamps: ExperimentRun["timestamps"], currentTimestamp: number) {
  if (timestamps.finishedAt) return timestamps.finishedAt;
  if (currentTimestamp - toEpochMs(timestamps.updatedAt) > 2 * 60 * 1000) {
    return toEpochMs(timestamps.updatedAt);
  }
  return undefined;
}

function pollIntervalMs({
  keepFetching,
  isSomeRunning,
}: {
  keepFetching: boolean;
  isSomeRunning: boolean;
}): number {
  if (keepFetching) return 1;
  return isSomeRunning ? 3000 : 10_000;
}

/** The poll state the runs list query reads before the runs are known. */
export function useBatchRunsPolling() {
  const [isSomeRunning, setIsSomeRunning] = useState(false);
  const [keepFetching, setKeepFetching] = useState(false);
  const refetchInterval = pollIntervalMs({ keepFetching, isSomeRunning });
  return { refetchInterval, setIsSomeRunning, setKeepFetching };
}

/**
 * Polls while a selected run is missing from the list, giving up after a
 * deadline armed once per wait (on a ref) so list churn can't push it out.
 */
function useKeepFetchingWhileRunIsMissing({
  isRunMissing,
  setKeepFetching,
}: {
  isRunMissing: boolean;
  setKeepFetching: (isKeepFetching: boolean) => void;
}) {
  const deadlineRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!isRunMissing) {
      setKeepFetching(false);
      return;
    }
    setKeepFetching(true);
    if (!deadlineRef.current) {
      deadlineRef.current = setTimeout(() => {
        deadlineRef.current = null;
        setKeepFetching(false);
      }, 5_000);
    }
  }, [isRunMissing, setKeepFetching]);
  useEffect(
    () => () => {
      if (deadlineRef.current) clearTimeout(deadlineRef.current);
    },
    [],
  );
}

/** The selected run (explicit, else the URL's, else the newest) and whether it finished. */
export function useBatchRunSelection({
  runs,
  selectedRunId,
  routerRunId,
  selectRun,
  polling,
}: {
  runs: ExperimentRun[] | undefined;
  selectedRunId: string | undefined;
  routerRunId: string | undefined;
  selectRun: (runId: string) => void;
  polling: ReturnType<typeof useBatchRunsPolling>;
}) {
  const { selectedRunId_, selectedRun } = useMemo(() => {
    const selectedRunId_ = selectedRunId ?? routerRunId ?? runs?.[0]?.runId;
    return { selectedRunId_, selectedRun: runs?.find((r) => r.runId === selectedRunId_) };
  }, [selectedRunId, routerRunId, runs]);

  useKeepFetchingWhileRunIsMissing({
    isRunMissing: !!selectedRunId && !selectedRun,
    setKeepFetching: polling.setKeepFetching,
  });

  const isFinished = useMemo(
    () =>
      !!selectedRun &&
      getFinishedAt(selectedRun.timestamps, nowInstant().epochMilliseconds) !== undefined,
    [selectedRun],
  );

  const { setIsSomeRunning } = polling;
  useEffect(() => {
    const now = nowInstant().epochMilliseconds;
    setIsSomeRunning(!!runs?.some((r) => getFinishedAt(r.timestamps, now) === undefined));
  }, [runs, setIsSomeRunning]);

  const selectRun_ = useCallback((runId: string) => selectRun(runId), [selectRun]);
  return { selectedRun, selectedRunId: selectedRunId_, setSelectedRunId: selectRun_, isFinished };
}
