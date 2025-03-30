import { DashboardLayout } from "../../../components/DashboardLayout";

import { useRouter } from "next/router";
import { DSPyExperiment } from "../../../components/experiments/DSPyExperiment";
import { useOrganizationTeamProject } from "../../../hooks/useOrganizationTeamProject";
import { api } from "../../../utils/api";
import BatchEvaluation from "../../../components/experiments/BatchEvaluation";
import { ExperimentType } from "@prisma/client";
import { BatchEvaluationV2 } from "../../../components/experiments/BatchEvaluationV2";

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
    }
  );

  return (
    <DashboardLayout>
      {project &&
        experiment.data &&
        (experiment.data.type === ExperimentType.DSPY ? (
          <DSPyExperiment project={project} experiment={experiment.data} />
        ) : experiment.data.type === ExperimentType.BATCH_EVALUATION ? (
          <BatchEvaluation project={project} experiment={experiment.data} />
        ) : experiment.data.type === ExperimentType.BATCH_EVALUATION_V2 ? (
          <BatchEvaluationV2 project={project} experiment={experiment.data} />
        ) : (
          <div>Unknown experiment type</div>
        ))}
    </DashboardLayout>
  );
}
