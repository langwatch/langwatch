import { useOrganizationTeamProject } from "../../../../hooks/useOrganizationTeamProject";
import { api } from "../../../../utils/api";
import type { Step } from "./evaluation-wizard-store/useEvaluationWizardStore";
import {
  EXECUTION_METHODS,
  STEPS,
  TASK_TYPES,
  useEvaluationWizardStore,
} from "./evaluation-wizard-store/useEvaluationWizardStore";

export const useStepCompletedValue = () => {
  const { project } = useOrganizationTeamProject();

  const { task, executionMethod, datasetId, evaluator } =
    useEvaluationWizardStore(
      ({
        workbenchState,
        setWizardState,
        getDatasetId,
        getFirstEvaluatorNode,
      }) => ({
        task: workbenchState.task,
        executionMethod: workbenchState.executionMethod,
        setWizardState,
        datasetId: getDatasetId(),
        evaluator: getFirstEvaluatorNode(),
      }),
    );

  const databaseDataset = api.datasetRecord.getAll.useQuery(
    { projectId: project?.id ?? "", datasetId: datasetId ?? "" },
    {
      enabled: !!project && !!datasetId,
      refetchOnWindowFocus: false,
    },
  );

  const getStepValue = (step: Step | "all") => {
    switch (step) {
      case "all":
        return STEPS.every((step) =>
          (getStepValue as (step: Step) => boolean)(step),
        );
      case "task":
        return task ? TASK_TYPES[task] : undefined;
      case "dataset":
        return databaseDataset?.data?.name;
      case "execution":
        return executionMethod ? EXECUTION_METHODS[executionMethod] : undefined;
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
