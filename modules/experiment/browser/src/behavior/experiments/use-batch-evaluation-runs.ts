import { useRouter } from "@langwatch/browser-host/use-router";
import { api } from "@langwatch/browser-trpc/workflow-api";
import { useBatchRunSelection, useBatchRunsPolling } from "@langwatch/experiment-browser-kit";
import type { ExperimentRun } from "@langwatch/experiment-contract";
import type { Experiment, Project } from "@langwatch/workflow-contract";
import { useCallback } from "react";

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
  const polling = useBatchRunsPolling();
  const batchEvaluationRuns = api.experiments.getExperimentBatchEvaluationRuns.useQuery(
    { projectId: project?.id ?? "", experimentId: experiment?.id ?? "" },
    { refetchInterval: polling.refetchInterval, enabled: !!project && !!experiment },
  );
  const router = useRouter();
  const runs: ExperimentRun[] | undefined = batchEvaluationRuns.data?.runs;
  const selectRun = useCallback(
    (runId: string) => {
      if (setSelectedRunId) {
        setSelectedRunId(runId);
      } else {
        void router.push({ query: { ...router.query, runId } });
      }
    },
    [router, setSelectedRunId],
  );
  const selection = useBatchRunSelection({
    runs,
    selectedRunId,
    routerRunId: typeof router.query.runId === "string" ? router.query.runId : undefined,
    selectRun,
    polling,
  });
  return { batchEvaluationRuns, ...selection };
};
