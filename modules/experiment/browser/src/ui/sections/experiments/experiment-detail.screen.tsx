import { isNotFoundError as isNotFound } from "@langwatch/browser-host/errors";
import { useOrganizationTeamProject } from "@langwatch/browser-host/use-organization-team-project";
import { useRouter } from "@langwatch/browser-host/use-router";
import { PageLayout } from "@langwatch/design-system/page-layout";
import { Alert, Box } from "@langwatch/design-system/primitives";

import { experimentApi } from "../../../behavior/experiment-api.ts";
import { useLegacyBatchEvaluations } from "../../../behavior/experiments/use-legacy-batch-evaluations.ts";
import { ExperimentType } from "../../../model/prisma-types.ts";
import BatchEvaluation from "../../../ui/elements/experiments/batch-evaluation.tsx";
import { DSPyExperiment } from "../../../ui/elements/experiments/ds-py-experiment.tsx";
import { BatchEvaluationResults } from "../../../ui/sections/batch-evaluation-results/index.ts";
import { HandledErrorAlert } from "../../elements/workflow/studio-host/errors.tsx";

export default function ExperimentPage() {
  const router = useRouter();

  const { project } = useOrganizationTeamProject();
  const { experiment: experimentSlug } = router.query;

  const experiment = experimentApi.experiments.getExperimentBySlugOrId.useQuery(
    {
      projectId: project?.id ?? "",
      experimentSlug: experimentSlug as string,
    },
    {
      enabled: !!project && typeof experimentSlug === "string",
    },
  );

  const legacyBatchEvaluations = useLegacyBatchEvaluations({
    project,
    experiment: experiment.data,
    enabled: !!project && experiment.data?.type === ExperimentType.BATCH_EVALUATION,
  });

  // Check for not found (query completed with error code NOT_FOUND)
  const experimentNotFound = isNotFound(experiment.error);

  // Check for other errors
  const isError = experiment.isError && !experimentNotFound;

  // Show error states inside DashboardLayout so user can navigate away
  if (experimentNotFound) {
    return (
      <Box width="full">
        <PageLayout.Container>
          <Alert.Root status="warning">
            <Alert.Indicator />
            <Alert.Title>Experiment not found</Alert.Title>
            <Alert.Description>
              The experiment you&apos;re looking for doesn&apos;t exist or you don&apos;t have
              access to it.
            </Alert.Description>
          </Alert.Root>
        </PageLayout.Container>
      </Box>
    );
  }

  if (isError) {
    return (
      <Box width="full">
        <PageLayout.Container>
          <HandledErrorAlert
            error={experiment.error}
            fallbackTitle="Couldn't load this experiment"
          />
        </PageLayout.Container>
      </Box>
    );
  }

  if (project && experiment.data?.type === ExperimentType.DSPY) {
    return (
      <Box width="full">
        <DSPyExperiment project={project} experiment={experiment.data} />
      </Box>
    );
  }

  if (project && experiment.data?.type === ExperimentType.BATCH_EVALUATION) {
    return (
      <Box width="full">
        <BatchEvaluation
          project={project}
          experiment={experiment.data}
          evaluations={legacyBatchEvaluations}
        />
      </Box>
    );
  }

  if (
    !project ||
    experiment.data === undefined ||
    experiment.data.type === ExperimentType.BATCH_EVALUATION_V2 ||
    experiment.data.type === ExperimentType.EVALUATIONS_V3
  ) {
    return (
      <Box width="full">
        <BatchEvaluationResults project={project} experiment={experiment.data} />
      </Box>
    );
  }

  return (
    <Box width="full">
      <PageLayout.Container>
        <Alert.Root status="warning">
          <Alert.Indicator />
          <Alert.Title>Unknown experiment type</Alert.Title>
          <Alert.Description>
            This experiment has an unrecognized type: {experiment.data.type}
          </Alert.Description>
        </Alert.Root>
      </PageLayout.Container>
    </Box>
  );
}
