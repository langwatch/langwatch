import { ReplicateToProjectDialog } from "~/components/ui/ReplicateToProjectDialog";
import { useProjectsForCopy } from "~/hooks/useProjectsForCopy";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { api } from "../../utils/api";

export const CopyPromptDialog = ({
  open,
  onClose,
  onSuccess,
  promptId,
  promptName,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  promptId: string;
  promptName: string;
}) => {
  const { project } = useOrganizationTeamProject();
  const copyPrompt = api.prompts.copy.useMutation();
  const projects = useProjectsForCopy("prompts:create");

  if (!project) return null;

  return (
    <ReplicateToProjectDialog
      open={open}
      onClose={onClose}
      onSuccess={onSuccess}
      title="Replicate Prompt"
      entityLabel="Prompt"
      sourceName={promptName}
      sourceId={promptId}
      sourceProjectId={project.id}
      projects={projects}
      onCopy={async ({ projectId, sourceProjectId }) => {
        await copyPrompt.mutateAsync({
          idOrHandle: promptId,
          projectId,
          sourceProjectId,
        });
      }}
      isLoading={copyPrompt.isLoading}
    />
  );
};
