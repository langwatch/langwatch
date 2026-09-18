import { api } from "@langwatch/browser-trpc/workflow-api";
import type { Experiment, Project } from "@langwatch/workflow-contract";

import type { BatchEvaluation } from "../../model/prisma-types.ts";

/**
 * The legacy (pre-V2) batch evaluation rows for an experiment.
 * Moved out of the `BatchEvaluation` element (Record 10: elements cannot fetch).
 */
export const useLegacyBatchEvaluations = ({
  project,
  experiment,
  enabled,
}: {
  project: Project | undefined;
  experiment: Experiment | undefined;
  enabled: boolean;
}) => {
  const evaluationsQuery = api.batchRecord.getAllByexperimentSlug.useQuery(
    {
      projectId: project?.id ?? "",
      experimentSlug: experiment?.slug ?? "",
    },
    { enabled },
  );
  return evaluationsQuery as { data?: BatchEvaluation[]; isLoading: boolean };
};
