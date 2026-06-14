import { useProjectsForCopy } from "~/hooks/useProjectsForCopy";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { createLogger } from "~/utils/logger";
import { ReplicateToProjectDialog } from "../ui/ReplicateToProjectDialog";

const logger = createLogger("CopyMonitorDialog");

/**
 * Replicates an online evaluator (monitor) into another project. Works for
 * every monitor: evaluator-backed ones bring their evaluator (and workflow)
 * along via `monitors.copy`, legacy wizard ones carry their inline settings.
 */
export const CopyMonitorDialog = ({
  open,
  onClose,
  onSuccess,
  monitorId,
  monitorName,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  monitorId: string;
  monitorName: string;
}) => {
  const { project } = useOrganizationTeamProject();
  const copyMonitor = api.monitors.copy.useMutation();
  const projects = useProjectsForCopy("evaluations:manage");

  if (!project) return null;

  return (
    <ReplicateToProjectDialog
      open={open}
      onClose={onClose}
      onSuccess={onSuccess}
      title="Replicate online evaluator"
      entityLabel="Online evaluator"
      sourceName={monitorName}
      sourceId={monitorId}
      sourceProjectId={project.id}
      projects={projects}
      onCopy={async ({ projectId, sourceProjectId }) => {
        await copyMonitor.mutateAsync({
          monitorId,
          projectId,
          sourceProjectId,
        });
      }}
      isLoading={copyMonitor.isLoading}
      logError={logger.error.bind(logger)}
    />
  );
};
