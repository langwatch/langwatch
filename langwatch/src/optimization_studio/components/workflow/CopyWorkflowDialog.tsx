import { useState } from "react";
import { Checkbox } from "../../../components/ui/checkbox";
import { ReplicateToProjectDialog } from "../../../components/ui/ReplicateToProjectDialog";
import { useOrganizationTeamProject } from "../../../hooks/useOrganizationTeamProject";
import { useProjectsForCopy } from "../../../hooks/useProjectsForCopy";
import { api } from "../../../utils/api";

export const CopyWorkflowDialog = ({
  open,
  onClose,
  workflowId,
  workflowName,
}: {
  open: boolean;
  onClose: () => void;
  workflowId: string;
  workflowName: string;
}) => {
  const { project } = useOrganizationTeamProject();
  const utils = api.useContext();
  const copyWorkflow = api.workflow.copy.useMutation();
  const projects = useProjectsForCopy("workflows:create");
  const [copyDatasets, setCopyDatasets] = useState(false);

  if (!project) return null;

  return (
    <ReplicateToProjectDialog
      open={open}
      onClose={onClose}
      onSuccess={() => void utils.workflow.getAll.invalidate()}
      title="Replicate Workflow"
      entityLabel="Workflow"
      sourceName={workflowName}
      sourceId={workflowId}
      sourceProjectId={project.id}
      projects={projects}
      onCopy={async ({ projectId, sourceProjectId, copyDatasets: copyDs }) => {
        await copyWorkflow.mutateAsync({
          workflowId,
          projectId,
          sourceProjectId,
          copyDatasets: Boolean(copyDs),
        });
      }}
      isLoading={copyWorkflow.isLoading}
      extraContent={
        <Checkbox
          checked={copyDatasets}
          onCheckedChange={(e) => setCopyDatasets(!!e.checked)}
        >
          Replicate associated dataset
        </Checkbox>
      }
      getExtraCopyParams={() => ({ copyDatasets })}
    />
  );
};
