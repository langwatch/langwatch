import { useRouter } from "~/utils/compat/next-router";
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
    void router.push(
      `/${project?.slug}/simulations/${ids.scenarioSetId}/${ids.batchRunId}/${ids.scenarioRunId}`,
    );
  };

  const goToSimulationSet = (simulationBatchId: string) => {
    void router.push(`/${project?.slug}/simulations/${simulationBatchId}`);
  };

  const goToSimulationBatchRuns = (
    scenarioSetId: string,
    simulationBatchId: string,
    options?: {
      replace?: boolean;
    },
  ) => {
    if (options?.replace) {
      void router.replace(
        `/${project?.slug}/simulations/${scenarioSetId}/${simulationBatchId}`,
      );
    } else {
      void router.push(
        `/${project?.slug}/simulations/${scenarioSetId}/${simulationBatchId}`,
      );
    }
  };

  const goToSimulationSets = () => {
    void router.push(`/${project?.slug}/simulations`);
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
