import { useEffect, useState } from "react";
import {
  PushToCopiesDialog as GenericPushToCopiesDialog,
  type PushToCopiesCopyItem,
} from "../ui/PushToCopiesDialog";
import { usePushAgentToCopies } from "~/hooks/usePushAgentToCopies";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

export const PushToCopiesDialog = ({
  open,
  onClose,
  agentId,
  agentName,
}: {
  open: boolean;
  onClose: () => void;
  agentId: string;
  agentName: string;
}) => {
  const { project } = useOrganizationTeamProject();
  const pushToCopies = usePushAgentToCopies();
  const [selectedCopyIds, setSelectedCopyIds] = useState<Set<string>>(
    new Set(),
  );

  const {
    data: copies,
    isLoading,
    error,
  } = api.agents.getCopies.useQuery(
    {
      projectId: project?.id ?? "",
      agentId,
    },
    {
      enabled: open && !!project?.id && !!agentId,
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
      entityLabel="Agent"
      sourceName={agentName}
      copies={availableCopies}
      isLoading={isLoading}
      error={error ? { message: error.message } : null}
      selectedCopyIds={selectedCopyIds}
      onToggleCopy={handleToggleCopy}
      onPush={async () =>
        pushToCopies.mutateAsync({
          agentId,
          projectId: project!.id,
          copyIds: Array.from(selectedCopyIds),
        })
      }
      pushLoading={pushToCopies.isLoading}
      onSuccess={() => setSelectedCopyIds(new Set())}
    />
  );
};
