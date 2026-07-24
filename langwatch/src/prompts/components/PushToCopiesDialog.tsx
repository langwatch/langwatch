import { useEffect, useState } from "react";
import {
  PushToCopiesDialog as GenericPushToCopiesDialog,
  type PushToCopiesCopyItem,
} from "../../components/ui/PushToCopiesDialog";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { api } from "../../utils/api";

export const PushToCopiesDialog = ({
  open,
  onClose,
  promptId,
  promptName,
}: {
  open: boolean;
  onClose: () => void;
  promptId: string;
  promptName: string;
}) => {
  const { project } = useOrganizationTeamProject();
  const pushToCopies = api.prompts.pushToCopies.useMutation();
  const utils = api.useContext();
  const [selectedCopyIds, setSelectedCopyIds] = useState<Set<string>>(
    new Set(),
  );

  const {
    data: copies,
    isLoading,
    error,
  } = api.prompts.getCopies.useQuery(
    {
      projectId: project?.id ?? "",
      idOrHandle: promptId,
    },
    {
      enabled: open && !!project?.id && !!promptId,
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
      entityLabel="Prompt"
      sourceName={promptName}
      copies={availableCopies}
      isLoading={isLoading}
      error={error ? { message: error.message } : null}
      selectedCopyIds={selectedCopyIds}
      onToggleCopy={handleToggleCopy}
      onPush={async () => {
        const result = await pushToCopies.mutateAsync({
          idOrHandle: promptId,
          projectId: project!.id,
          copyIds: Array.from(selectedCopyIds),
        });
        await utils.prompts.getAllPromptsForProject.invalidate();
        return result;
      }}
      pushLoading={pushToCopies.isLoading}
      bodyIntro="Select which replicas to push the latest version to:"
      onSuccess={() => setSelectedCopyIds(new Set())}
    />
  );
};
