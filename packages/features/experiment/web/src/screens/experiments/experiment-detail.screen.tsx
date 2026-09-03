import { Alert, Box } from "@chakra-ui/react";
import { HandledErrorAlert } from "@langwatch/workflow-web/studio-host/errors";
import { ExperimentType } from "../../model/prisma-types";
import { useRouter } from "@langwatch/workflow-web/studio-host/next-router";
import { BatchEvaluationResults } from "../../ui/sections/batch-evaluation-results";
import BatchEvaluation from "../../ui/elements/experiments/batch-evaluation";
// Note: BatchEvaluationV2 is kept for reference but no longer used - can be deleted after verification
import { DSPyExperiment } from "../../ui/elements/experiments/ds-py-experiment";
import { useOrganizationTeamProject } from "@langwatch/workflow-web/studio-host/use-organization-team-project";
import { api } from "@langwatch/workflow-web/studio-host/api";
import { isNotFound } from "@langwatch/trace-web/utils/trpcError";

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

  // Show error states inside DashboardLayout so user can navigate away
  if (experimentNotFound) {
    return (
      <Box width="full">
        <Box padding={6}>
          <Alert.Root status="warning">
            <Alert.Indicator />
            <Alert.Title>Experiment not found</Alert.Title>
            <Alert.Description>
              The experiment you&apos;re looking for doesn&apos;t exist or you don&apos;t have
              access to it.
            </Alert.Description>
          </Alert.Root>
        </Box>
      </Box>
    );
  }

  if (isError) {
    return (
      <Box width="full">
        <Box padding={6}>
          <HandledErrorAlert
            error={experiment.error}
            fallbackTitle="Couldn't load this experiment"
          />
        </Box>
      </Box>
    );
  }

  return (
    <Box width="full">
      {project && experiment.data?.type === ExperimentType.DSPY ? (
        <DSPyExperiment project={project} experiment={experiment.data} />
      ) : project && experiment.data?.type === ExperimentType.BATCH_EVALUATION ? (
        <BatchEvaluation project={project} experiment={experiment.data} />
      ) : !project ||
        experiment.data === undefined ||
        experiment.data.type === ExperimentType.BATCH_EVALUATION_V2 ||
        experiment.data.type === ExperimentType.EVALUATIONS_V3 ? (
        <BatchEvaluationResults project={project} experiment={experiment.data} />
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
    </Box>
  );
}
