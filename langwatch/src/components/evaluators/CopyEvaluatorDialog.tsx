import { createLogger } from "@langwatch/observability";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useProjectsForCopy } from "~/hooks/useProjectsForCopy";
import { api } from "~/utils/api";
import { ReplicateToProjectDialog } from "../ui/ReplicateToProjectDialog";

const logger = createLogger("CopyEvaluatorDialog");

export const CopyEvaluatorDialog = ({
  open,
  onClose,
  onSuccess,
  evaluatorId,
  evaluatorName,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  evaluatorId: string;
  evaluatorName: string;
}) => {
  const { project } = useOrganizationTeamProject();
  const copyEvaluator = api.evaluators.copy.useMutation();
  const projects = useProjectsForCopy("evaluations:manage");

  if (!project) return null;

  return (
    <ReplicateToProjectDialog
      open={open}
      onClose={onClose}
      onSuccess={onSuccess}
      title="Replicate Evaluator"
      entityLabel="Evaluator"
      sourceName={evaluatorName}
      sourceId={evaluatorId}
      sourceProjectId={project.id}
      projects={projects}
      onCopy={async ({ projectId, sourceProjectId }) => {
        await copyEvaluator.mutateAsync({
          evaluatorId,
          projectId,
          sourceProjectId,
        });
      }}
      isLoading={copyEvaluator.isLoading}
      logError={logger.error.bind(logger)}
    />
  );
};
