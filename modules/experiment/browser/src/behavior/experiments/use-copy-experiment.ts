import { showErrorToast } from "@langwatch/browser-host/errors";
import { toaster } from "@langwatch/browser-host/toaster";
import { api } from "@langwatch/browser-trpc/workflow-api";

/**
 * Replicates an experiment into another project.
 * Moved out of `CopyExperimentDialog` (Record 10: elements cannot fetch).
 */
export const useCopyExperiment = () => {
  const utils = api.useUtils();
  const copyExperiment = api.experiments.copy.useMutation();

  const copyExperimentTo = async ({
    experimentId,
    experimentName,
    sourceProjectId,
    targetProjectId,
    targetProjectName,
    copyDatasets,
    onSuccess,
  }: {
    experimentId: string;
    experimentName: string;
    sourceProjectId: string;
    targetProjectId: string;
    targetProjectName: string;
    copyDatasets: boolean;
    onSuccess: () => void;
  }) => {
    try {
      await copyExperiment.mutateAsync({
        experimentId,
        projectId: targetProjectId,
        sourceProjectId,
        copyDatasets,
      });

      // Invalidate queries to refresh the experiment list
      await utils.experiments.getAllForEvaluationsList.invalidate();

      toaster.create({
        title: "Experiment replicated",
        description: `Experiment "${experimentName}" replicated successfully to ${targetProjectName}.`,
        type: "success",
      });

      onSuccess();
    } catch (error) {
      showErrorToast({
        error,
        fallbackTitle: "Couldn't replicate the experiment",
      });
    }
  };

  return { copyExperimentTo, isCopying: copyExperiment.isPending };
};
