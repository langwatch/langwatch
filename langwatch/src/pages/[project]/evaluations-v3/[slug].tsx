/**
 * Evaluations V3 Page
 *
 * New spreadsheet-based evaluation experience.
 */

import { useRouter } from "next/router";
import { useEffect } from "react";
import { EvaluationV3Container } from "../../../features/evaluations-v3/components/EvaluationV3Container";
import { useOrganizationTeamProject } from "../../../hooks/useOrganizationTeamProject";
import { DashboardLayout } from "../../../components/DashboardLayout";
import { api } from "../../../utils/api";
import { dslToState } from "../../../features/evaluations-v3/utils/dslMapper";
import { useEvaluationV3Store } from "../../../features/evaluations-v3/store/useEvaluationV3Store";
import { useShallow } from "zustand/react/shallow";
import { useAvailableEvaluators } from "../../../hooks/useAvailableEvaluators";
import { Skeleton, VStack } from "@chakra-ui/react";

function EvaluationsV3Page() {
  const router = useRouter();
  const { project } = useOrganizationTeamProject();
  const slug = router.query.slug as string;
  const availableEvaluators = useAvailableEvaluators();

  const { setState, reset } = useEvaluationV3Store(
    useShallow((s) => ({
      setState: s.setState,
      reset: s.reset,
    }))
  );

  // Fetch experiment if slug exists and is not "new"
  const experiment = api.experiments.getExperimentWithDSLBySlug.useQuery(
    {
      projectId: project?.id ?? "",
      experimentSlug: slug,
    },
    {
      enabled: !!project && !!slug && slug !== "new",
      refetchOnWindowFocus: false,
    }
  );

  // Load experiment data into store
  useEffect(() => {
    if (slug === "new") {
      reset();
      return;
    }

    if (experiment.data?.dsl && availableEvaluators) {
      const state = dslToState(experiment.data.dsl, availableEvaluators);
      setState({
        ...state,
        id: experiment.data.id,
        experimentId: experiment.data.id,
        experimentSlug: experiment.data.slug,
        name: experiment.data.name ?? "Evaluation",
      });
    }
  }, [experiment.data, availableEvaluators, slug, setState, reset]);

  // Handle new evaluation redirect
  useEffect(() => {
    if (slug === "new" && project) {
      // Generate a temporary slug and redirect
      const tempSlug = `eval-${Date.now()}`;
      void router.replace(`/${project.slug}/evaluations-v3/${tempSlug}`);
    }
  }, [slug, project, router]);

  if (!project) {
    return (
      <DashboardLayout>
        <VStack width="full" padding={8}>
          <Skeleton height="60px" width="full" />
          <Skeleton height="400px" width="full" />
        </VStack>
      </DashboardLayout>
    );
  }

  if (slug !== "new" && experiment.isLoading) {
    return (
      <DashboardLayout>
        <VStack width="full" padding={8}>
          <Skeleton height="60px" width="full" />
          <Skeleton height="400px" width="full" />
        </VStack>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout backgroundColor="gray.50">
      <EvaluationV3Container />
    </DashboardLayout>
  );
}

export default EvaluationsV3Page;

