import { useRouter } from "next/router";
import { useOrganizationTeamProject } from "../useOrganizationTeamProject";

export const useSimulationRouter = () => {
  const router = useRouter();
  const { project } = useOrganizationTeamProject();

  const goToSimulationRun = (simulationRunId: string) => {
    router.push(`/${project?.slug}/simulations/${simulationRunId}`);
  };

  const goToSimulationBatch = (simulationBatchId: string) => {
    router.push(`/${project?.slug}/simulations/${simulationBatchId}`);
  };

  return {
    ...router,
    slug: router.query.slug?.toString(),
    goToSimulationRun,
    goToSimulationBatch,
  };
};
