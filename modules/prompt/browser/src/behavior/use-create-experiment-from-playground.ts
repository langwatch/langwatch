import { promptApi } from "./prompt-api.ts";

/** Creates the experiment the playground hands its tabs to, and refreshes the experiments list. */
export function useCreateExperimentFromPlayground({
  onSuccess,
  onError,
}: {
  onSuccess: (experiment: { slug: string }) => void;
  onError: () => void;
}) {
  const utils = promptApi.useUtils();
  return promptApi.experiments.saveEvaluationsV3.useMutation({
    onSuccess: (experiment) => {
      void utils.experiments.getAllForEvaluationsList.invalidate();
      onSuccess(experiment);
    },
    onError,
  });
}
