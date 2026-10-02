import type { UiHostProject } from "@langwatch/browser-host/use-organization-team-project";
import { datasetClient } from "@langwatch/dataset-client";

import type { ExperimentRow } from "../../model/experiment-api-map.ts";
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
  project: UiHostProject | undefined;
  experiment: ExperimentRow | undefined;
  enabled: boolean;
}) => {
  const evaluationsQuery = datasetClient.batchRecord.getAllByexperimentSlug.useQuery(
    {
      projectId: project?.id ?? "",
      experimentSlug: experiment?.slug ?? "",
    },
    { enabled },
  );
  return evaluationsQuery as { data?: BatchEvaluation[]; isLoading: boolean };
};
