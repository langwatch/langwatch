import { Alert, Box } from "@chakra-ui/react";
import { ExperimentType } from "@prisma/client";

import { useRouter } from "next/router";
import { BatchEvaluationResults } from "../../../components/batch-evaluation-results";
import { DashboardLayout } from "../../../components/DashboardLayout";
import BatchEvaluation from "../../../components/experiments/BatchEvaluation";
// Note: BatchEvaluationV2 is kept for reference but no longer used - can be deleted after verification
import { DSPyExperiment } from "../../../components/experiments/DSPyExperiment";
import { LoadingScreen } from "../../../components/LoadingScreen";
import { useOrganizationTeamProject } from "../../../hooks/useOrganizationTeamProject";
import { api } from "../../../utils/api";
import { isNotFound } from "../../../utils/trpcError";

export default function ExperimentPage() {
  const router = useRouter();

  const { project } = useOrganizationTeamProject();
  const { experiment: experimentSlug } = router.query;

  const experiment = api.experiments.getExperimentBySlugOrId.useQuery(
    {
      projectId: project?.id ?? "",
      experimentSlug: experimentSlug as string,
    },
    {
      enabled: !!project && typeof experimentSlug === "string",
    },
  );

  // Check for not found (query completed with error code NOT_FOUND)
  const experimentNotFound = isNotFound(experiment.error);

  // Check for other errors
  const isError = experiment.isError && !experimentNotFound;

  if (!project || experiment.isLoading) {
    return <LoadingScreen />;
  }

  // Show error states inside DashboardLayout so user can navigate away
  if (experimentNotFound || !experiment.data) {
    return (
      <DashboardLayout>
        <Box padding={6}>
          <Alert.Root status="warning">
            <Alert.Indicator />
            <Alert.Title>Experiment not found</Alert.Title>
            <Alert.Description>
              The experiment you&apos;re looking for doesn&apos;t exist or you
              don&apos;t have access to it.
            </Alert.Description>
          </Alert.Root>
        </Box>
      </DashboardLayout>
    );
  }

  if (isError) {
    return (
      <DashboardLayout>
        <Box padding={6}>
          <Alert.Root status="error">
            <Alert.Indicator />
            <Alert.Title>Failed to load experiment</Alert.Title>
            <Alert.Description>
              {experiment.error?.message ??
                "An unexpected error occurred while loading the experiment."}
            </Alert.Description>
          </Alert.Root>
        </Box>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      {experiment.data.type === ExperimentType.DSPY ? (
        <DSPyExperiment project={project} experiment={experiment.data} />
      ) : experiment.data.type === ExperimentType.BATCH_EVALUATION ? (
        <BatchEvaluation project={project} experiment={experiment.data} />
      ) : experiment.data.type === ExperimentType.BATCH_EVALUATION_V2 ||
        experiment.data.type === ExperimentType.EVALUATIONS_V3 ? (
        <BatchEvaluationResults
          project={project}
          experiment={experiment.data}
        />
      ) : (
        <Box padding={6}>
          <Alert.Root status="warning">
            <Alert.Indicator />
            <Alert.Title>Unknown experiment type</Alert.Title>
            <Alert.Description>
              This experiment has an unrecognized type: {experiment.data.type}
            </Alert.Description>
          </Alert.Root>
        </Box>
      )}
    </DashboardLayout>
  );
}
