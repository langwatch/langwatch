import type { UiHostProject } from "@langwatch/browser-host/use-organization-team-project";
import { useRouter } from "@langwatch/browser-host/use-router";
import type { ExperimentRun } from "@langwatch/experiment-contract";
import { useCallback } from "react";

import type { ExperimentRow } from "../../model/experiment-api-map.ts";
import { experimentApi } from "../experiment-api.ts";
import { useBatchRunSelection } from "../use-batch-run-selection.ts";

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
  project?: UiHostProject;
  experiment?: ExperimentRow;
  selectedRunId?: string;
  setSelectedRunId?: (runId: string) => void;
}) => {
  const batchEvaluationRuns = experimentApi.experiments.getExperimentBatchEvaluationRuns.useQuery(
    { projectId: project?.id ?? "", experimentId: experiment?.id ?? "" },
    {
      enabled: !!project && !!experiment,
      // needs a read hint: batch evaluation run started or finished
    },
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
  });
  return { batchEvaluationRuns, ...selection };
};
