import { useEffect, useState } from "react";
import {
  PushToCopiesDialog as GenericPushToCopiesDialog,
  type PushToCopiesCopyItem,
} from "../../../components/ui/PushToCopiesDialog";
import { useOrganizationTeamProject } from "../../../hooks/useOrganizationTeamProject";
import { api } from "../../../utils/api";

export const PushToCopiesDialog = ({
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
  const pushToCopies = api.workflow.pushToCopies.useMutation();
  const utils = api.useContext();
  const [selectedCopyIds, setSelectedCopyIds] = useState<Set<string>>(
    new Set(),
  );

  const {
    data: copies,
    isLoading,
    error,
  } = api.workflow.getCopies.useQuery(
    {
      projectId: project?.id ?? "",
      workflowId,
    },
    {
      enabled: open && !!project?.id && !!workflowId,
    },
  );

  const [availableCopies, setAvailableCopies] = useState<
    PushToCopiesCopyItem[]
  >([]);

  useEffect(() => {
    if (!copies) return;
    setAvailableCopies(copies);
    setSelectedCopyIds(new Set(copies.map((c) => c.id)));
  }, [copies]);

  const handleToggleCopy = (copyId: string) => {
    const newSelected = new Set(selectedCopyIds);
    if (newSelected.has(copyId)) {
      newSelected.delete(copyId);
    } else {
      newSelected.add(copyId);
    }
    setSelectedCopyIds(newSelected);
  };

  return (
    <GenericPushToCopiesDialog
      open={open}
      onClose={onClose}
      entityLabel="Workflow"
      sourceName={workflowName}
      copies={availableCopies}
      isLoading={isLoading}
      error={error ? { message: error.message } : null}
      selectedCopyIds={selectedCopyIds}
      onToggleCopy={handleToggleCopy}
      onPush={async () => {
        if (!project) {
          throw new Error("No project available for push");
        }
        const result = await pushToCopies.mutateAsync({
          workflowId,
          projectId: project.id,
          copyIds: Array.from(selectedCopyIds),
        });
        await utils.workflow.getAll.invalidate();
        return result;
      }}
      pushLoading={pushToCopies.isLoading}
      bodyIntro="Select which replicas to push the latest version to:"
      emptyMessage={
        <>
          No replicas found. This may be because you don't have
          workflows:update permission on the replica projects, or the
          replicas have been archived.
        </>
      }
      onSuccess={() => setSelectedCopyIds(new Set())}
    />
  );
};
