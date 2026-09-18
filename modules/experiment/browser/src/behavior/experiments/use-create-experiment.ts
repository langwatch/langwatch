import { showErrorToast } from "@langwatch/browser-host/errors";
import { useRouter } from "@langwatch/browser-host/use-router";
import { api } from "@langwatch/browser-trpc/workflow-api";
import { generateHumanReadableId } from "@langwatch/experiment-contract";
import { useState } from "react";

import { createInitialState } from "../../model/experiments-v3/types.ts";
import { extractPersistedState } from "../../model/experiments-v3/types/persistence.ts";

/**
 * Creates a new EVALUATIONS_V3 experiment and navigates to its workbench.
 * Moved out of `CreateExperimentButton` (Record 10: elements cannot fetch).
 */
export const useCreateExperiment = ({
  projectId,
  projectSlug,
}: {
  projectId: string | undefined;
  projectSlug: string | undefined;
}) => {
  const router = useRouter();
  const [isCreating, setIsCreating] = useState(false);
  const utils = api.useUtils();
  const createExperiment = api.experiments.saveEvaluationsV3.useMutation({
    onSuccess: (data) => {
      void utils.experiments.getAllForEvaluationsList.invalidate();
      void router.push(`/${projectSlug}/experiments/workbench/${data.slug}`);
      setIsCreating(false);
    },
    onError: (error) => {
      setIsCreating(false);
      showErrorToast({
        error,
        fallbackTitle: "Couldn't create the experiment",
      });
    },
  });

  const createNewExperiment = () => {
    if (isCreating) return;

    setIsCreating(true);
    const name = generateHumanReadableId();
    const initialState = createInitialState();
    initialState.name = name;
    const persistedState = extractPersistedState(initialState);

    createExperiment.mutate({
      projectId: projectId ?? "",
      experimentId: undefined,
      state: {
        ...persistedState,
        experimentSlug: name,
      },
    });
  };

  return { createNewExperiment, isCreating };
};
