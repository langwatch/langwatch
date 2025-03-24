import { EXECUTION_METHODS, STEPS } from "./useEvaluationWizardStore";
import { TASK_TYPES } from "./useEvaluationWizardStore";
import type { Step } from "./useEvaluationWizardStore";
import { useOrganizationTeamProject } from "../../../../hooks/useOrganizationTeamProject";
import { api } from "../../../../utils/api";
import { useEvaluationWizardStore } from "./useEvaluationWizardStore";

export const useStepCompletedValue = () => {
  const { project } = useOrganizationTeamProject();

  const { wizardState, datasetId, evaluator } = useEvaluationWizardStore(
    ({ wizardState, setWizardState, getDatasetId, getFirstEvaluatorNode }) => ({
      wizardState,
      setWizardState,
      datasetId: getDatasetId(),
      evaluator: getFirstEvaluatorNode(),
    })
  );

  const databaseDataset = api.datasetRecord.getAll.useQuery(
    { projectId: project?.id ?? "", datasetId: datasetId ?? "" },
    {
      enabled: !!project && !!datasetId,
      refetchOnWindowFocus: false,
    }
  );

  const getStepValue = (step: Step | "all") => {
    switch (step) {
      case "all":
        return STEPS.every((step) =>
          (getStepValue as (step: Step) => boolean)(step)
        );
      case "task":
        return wizardState.task ? TASK_TYPES[wizardState.task] : undefined;
      case "dataset":
        return databaseDataset?.data?.name;
      case "execution":
        return wizardState.task === "real_time"
          ? "When message arrives"
          : wizardState.executionMethod
          ? EXECUTION_METHODS[wizardState.executionMethod]
          : undefined;
      case "evaluation":
        return evaluator?.data?.name;
      case "results":
        return true;
      default:
        step satisfies never;
        return undefined;
    }
  };

  return getStepValue;
};
