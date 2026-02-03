import { useEffect, useState } from "react";
import {
  PushToCopiesDialog as GenericPushToCopiesDialog,
  type PushToCopiesCopyItem,
} from "../ui/PushToCopiesDialog";
import { usePushEvaluatorToCopies } from "~/hooks/usePushEvaluatorToCopies";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

export const PushToCopiesDialog = ({
  open,
  onClose,
  evaluatorId,
  evaluatorName,
}: {
  open: boolean;
  onClose: () => void;
  evaluatorId: string;
  evaluatorName: string;
}) => {
  const { project } = useOrganizationTeamProject();
  const pushToCopies = usePushEvaluatorToCopies();
  const [selectedCopyIds, setSelectedCopyIds] = useState<Set<string>>(
    new Set(),
  );

  const {
    data: copies,
    isLoading,
    error,
  } = api.evaluators.getCopies.useQuery(
    {
      projectId: project?.id ?? "",
      evaluatorId,
    },
    {
      enabled: open && !!project?.id && !!evaluatorId,
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
      entityLabel="Evaluator"
      sourceName={evaluatorName}
      copies={availableCopies}
      isLoading={isLoading}
      error={error ? { message: error.message } : null}
      selectedCopyIds={selectedCopyIds}
      onToggleCopy={handleToggleCopy}
      onPush={async () => {
        if (!project) {
          throw new Error("No project available for push");
        }
        return pushToCopies.mutateAsync({
          evaluatorId,
          projectId: project.id,
          copyIds: Array.from(selectedCopyIds),
        });
      }}
      pushLoading={pushToCopies.isLoading}
      onSuccess={() => setSelectedCopyIds(new Set())}
    />
  );
};
