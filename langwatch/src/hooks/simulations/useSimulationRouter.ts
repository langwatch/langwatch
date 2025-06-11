import { useRouter } from "next/router";
import { useOrganizationTeamProject } from "../useOrganizationTeamProject";

export const useSimulationRouter = () => {
  const router = useRouter();
  const { scenarioRunId, scenarioSetId, batchRunId } = router.query;
  const { project } = useOrganizationTeamProject();

  const goToSimulationRun = (ids: {
    scenarioSetId: string;
    batchRunId: string;
    scenarioRunId: string;
  }) => {
    router.push(
      `/${project?.slug}/simulations/${ids.scenarioSetId}/${ids.batchRunId}/${ids.scenarioRunId}`
    );
  };

  const goToSimulationSet = (simulationBatchId: string) => {
    router.push(`/${project?.slug}/simulations/${simulationBatchId}`);
  };

  const goToSimulationBatchRuns = (
    scenarioSetId: string,
    simulationBatchId: string,
    options?: {
      replace?: boolean;
    }
  ) => {
    if (options?.replace) {
      router.replace(
        `/${project?.slug}/simulations/${scenarioSetId}/${simulationBatchId}`
      );
    } else {
      router.push(
        `/${project?.slug}/simulations/${scenarioSetId}/${simulationBatchId}`
      );
    }
  };

  const goToSimulationSets = () => {
    router.push(`/${project?.slug}/simulations`);
  };

  return {
    ...router,
    scenarioSetId: scenarioSetId?.toString(),
    batchRunId: batchRunId?.toString(),
    scenarioRunId: scenarioRunId?.toString(),
    goToSimulationRun,
    goToSimulationSet,
    goToSimulationSets,
    goToSimulationBatchRuns,
  };
};
