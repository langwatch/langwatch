import { useRouter } from "@langwatch/browser-host/use-router";
import { api } from "@langwatch/browser-trpc/workflow-api";
import type { ExperimentRun } from "@langwatch/experiment-contract";
import { nowInstant, toEpochMs } from "@langwatch/time";
import type { Experiment, Project } from "@langwatch/workflow-contract";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * Duplicated from `ui/elements/.../batch-evaluation-summary.tsx` — behavior/
 * may not import ui/ (layer order). Same 5-line body, two owners.
 */
const getFinishedAt = (timestamps: ExperimentRun["timestamps"], currentTimestamp: number) => {
  if (timestamps.finishedAt) return timestamps.finishedAt;
  if (currentTimestamp - toEpochMs(timestamps.updatedAt) > 2 * 60 * 1000) {
    return toEpochMs(timestamps.updatedAt);
  }
  return undefined;
};

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
      if (deadlineRef.current) {
        clearTimeout(deadlineRef.current);
      }
    },
    [],
  );
}

/**
 * The batch evaluation runs list plus the currently selected run. Moved out
 * of `BatchEvaluationV2` (Record 10: elements cannot fetch).
 */
export const useBatchEvaluationState = ({
  project,
  experiment,
  selectedRunId,
  setSelectedRunId,
}: {
  project?: Project;
  experiment?: Experiment;
  selectedRunId?: string;
  setSelectedRunId?: (runId: string) => void;
}) => {
  const [isSomeRunning, setIsSomeRunning] = useState(false);
  const [keepFetching, setKeepFetching] = useState(false);

  const batchEvaluationRuns = api.experiments.getExperimentBatchEvaluationRuns.useQuery(
    {
      projectId: project?.id ?? "",
      experimentId: experiment?.id ?? "",
    },
    {
      refetchInterval: keepFetching ? 1 : isSomeRunning ? 3000 : 10_000,
      enabled: !!project && !!experiment,
    },
  );

  const router = useRouter();

  const { selectedRunId_, selectedRun } = useMemo(() => {
    const selectedRunId_ =
      selectedRunId ??
      (typeof router.query.runId === "string" ? router.query.runId : null) ??
      batchEvaluationRuns.data?.runs[0]?.runId;
    const selectedRun = batchEvaluationRuns.data?.runs.find((r: any) => r.runId === selectedRunId_);
    return { selectedRunId_, selectedRun };
  }, [selectedRunId, router.query.runId, batchEvaluationRuns.data?.runs]);

  useKeepFetchingWhileRunIsMissing({
    isRunMissing: !!selectedRunId && !selectedRun,
    setKeepFetching,
  });

  const setSelectedRunId_ = useCallback(
    (runId: string) => {
      if (setSelectedRunId) {
        setSelectedRunId(runId);
      } else {
        void router.push({ query: { ...router.query, runId } });
      }
    },
    [router, setSelectedRunId],
  );

  const isFinished = useMemo(() => {
    if (!selectedRun) {
      return false;
    }
    return getFinishedAt(selectedRun.timestamps, nowInstant().epochMilliseconds) !== undefined;
  }, [selectedRun]);

  useEffect(() => {
    if (
      batchEvaluationRuns.data?.runs.some(
        (r: any) => getFinishedAt(r.timestamps, nowInstant().epochMilliseconds) === undefined,
      )
    ) {
      setIsSomeRunning(true);
    } else {
      setIsSomeRunning(false);
    }
  }, [batchEvaluationRuns.data?.runs]);

  return {
    batchEvaluationRuns,
    selectedRun,
    selectedRunId: selectedRunId_,
    setSelectedRunId: setSelectedRunId_,
    isFinished,
  };
};
