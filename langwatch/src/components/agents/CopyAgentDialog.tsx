import { createLogger } from "~/utils/logger";
import { ReplicateToProjectDialog } from "~/components/ui/ReplicateToProjectDialog";
import { useProjectsForCopy } from "~/hooks/useProjectsForCopy";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

const logger = createLogger("CopyAgentDialog");

export const CopyAgentDialog = ({
  open,
  onClose,
  onSuccess,
  agentId,
  agentName,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  agentId: string;
  agentName: string;
}) => {
  const { project } = useOrganizationTeamProject();
  const copyAgent = api.agents.copy.useMutation();
  const projects = useProjectsForCopy("evaluations:manage");

  if (!project) return null;

  return (
    <ReplicateToProjectDialog
      open={open}
      onClose={onClose}
      onSuccess={onSuccess}
      title="Replicate Agent"
      entityLabel="Agent"
      sourceName={agentName}
      sourceId={agentId}
      sourceProjectId={project.id}
      projects={projects}
      onCopy={async ({ projectId, sourceProjectId }) => {
        await copyAgent.mutateAsync({
          agentId,
          projectId,
          sourceProjectId,
        });
      }}
      isLoading={copyAgent.isLoading}
      logError={logger.error.bind(logger)}
    />
  );
};
