/** The selected batch run and whether it finished. Consumers fetch. */
import type { ExperimentRun } from "@langwatch/experiment-contract";
import { nowInstant, toEpochMs } from "@langwatch/time";
import { useCallback, useMemo } from "react";

/** A run without a finish stamp counts as finished once it has been silent for two minutes. */
function getFinishedAt(timestamps: ExperimentRun["timestamps"], currentTimestamp: number) {
  if (timestamps.finishedAt) return timestamps.finishedAt;
  if (currentTimestamp - toEpochMs(timestamps.updatedAt) > 2 * 60 * 1000) {
    return toEpochMs(timestamps.updatedAt);
  }
  return undefined;
}

/** The selected run (explicit, else the URL's, else the newest) and whether it finished. */
export function useBatchRunSelection({
  runs,
  selectedRunId,
  routerRunId,
  selectRun,
}: {
  runs: ExperimentRun[] | undefined;
  selectedRunId: string | undefined;
  routerRunId: string | undefined;
  selectRun: (runId: string) => void;
}) {
  const { selectedRunId_, selectedRun } = useMemo(() => {
    const selectedRunId_ = selectedRunId ?? routerRunId ?? runs?.[0]?.runId;
    return { selectedRunId_, selectedRun: runs?.find((r) => r.runId === selectedRunId_) };
  }, [selectedRunId, routerRunId, runs]);

  const isFinished = useMemo(
    () =>
      !!selectedRun &&
      getFinishedAt(selectedRun.timestamps, nowInstant().epochMilliseconds) !== undefined,
    [selectedRun],
  );

  const selectRun_ = useCallback((runId: string) => selectRun(runId), [selectRun]);
  return { selectedRun, selectedRunId: selectedRunId_, setSelectedRunId: selectRun_, isFinished };
}
