import { useRouter } from "next/router";
import { useCallback } from "react";
import { useOrganizationTeamProject } from "../useOrganizationTeamProject";

export const useSimulationRouter = () => {
  const router = useRouter();
  const { scenarioRunId, scenarioSetId, batchRunId } = router.query;
  const { project } = useOrganizationTeamProject();

  const goToSimulationRun = useCallback(
    (ids: {
      scenarioSetId: string;
      batchRunId: string;
      scenarioRunId: string;
    }) => {
      void router.push(
        `/${project?.slug}/simulations/${ids.scenarioSetId}/${ids.batchRunId}/${ids.scenarioRunId}`,
      );
    },
    [router, project?.slug],
  );

  const goToSimulationSet = useCallback(
    (simulationBatchId: string) => {
      void router.push(`/${project?.slug}/simulations/${simulationBatchId}`);
    },
    [router, project?.slug],
  );

  const goToSimulationBatchRuns = useCallback(
    (
      scenarioSetId: string,
      simulationBatchId: string,
      options?: { replace?: boolean },
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
    },
    [router, project?.slug],
  );

  const goToSimulationSets = useCallback(() => {
    void router.push(`/${project?.slug}/simulations`);
  }, [router, project?.slug]);

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
