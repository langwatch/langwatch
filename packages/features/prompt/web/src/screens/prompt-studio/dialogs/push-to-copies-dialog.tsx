/**
 * The Push-to-replicas action on a published prompt.
 *
 * The generic `PushToCopiesDialog` did not travel — it reaches the toaster and
 * the application's `HandledErrorAlert` — so this wraps the family's narrowed
 * copy and tells the host what happened. The replicas listing already arrives
 * filtered to the ones the reader may write to; that filter is the server's.
 */

import { useEffect, useState } from "react";
import { promptApi } from "../../../behavior/prompt-api";
import { usePromptProject } from "../../../behavior/use-prompt-project";
import { usePromptHost } from "../../../model/prompt-host";
import { PromptPushDialog, type PromptCopyItem } from "../../../ui/blocks/prompt-push-dialog";

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
  const { project } = usePromptProject();
  const host = usePromptHost();
  const pushToCopies = promptApi.prompts.pushToCopies.useMutation();
  const utils = promptApi.useUtils();
  const [selectedCopyIds, setSelectedCopyIds] = useState<Set<string>>(new Set());

  const {
    data: copies,
    isLoading,
    error,
  } = promptApi.prompts.getCopies.useQuery(
    { projectId: project?.id ?? "", idOrHandle: promptId },
    { enabled: open && !!project?.id && !!promptId },
  );

  const [availableCopies, setAvailableCopies] = useState<PromptCopyItem[]>([]);

  useEffect(() => {
    if (!copies) return;
    setAvailableCopies(copies);
    setSelectedCopyIds(new Set(copies.map((copy) => copy.id)));
  }, [copies]);

  const handleToggleCopy = (copyId: string) => {
    setSelectedCopyIds((previous) => {
      const next = new Set(previous);
      if (next.has(copyId)) next.delete(copyId);
      else next.add(copyId);
      return next;
    });
  };

  return (
    <PromptPushDialog
      open={open}
      promptName={promptName}
      copies={availableCopies}
      isLoading={isLoading}
      {...(error ? { errorMessage: "Couldn't load the replicas for this prompt." } : {})}
      selectedCopyIds={selectedCopyIds}
      isPushing={pushToCopies.isPending}
      onClose={onClose}
      onToggleCopy={handleToggleCopy}
      onPush={async () => {
        if (!project) return;
        try {
          const result = await pushToCopies.mutateAsync({
            idOrHandle: promptId,
            projectId: project.id,
            copyIds: Array.from(selectedCopyIds),
          });
          await utils.prompts.getAllPromptsForProject.invalidate();
          host.succeeded({
            title: "Pushed to replicas",
            description: `Pushed "${promptName}" to ${result.pushed} of ${selectedCopyIds.size} replicas.`,
          });
          setSelectedCopyIds(new Set());
          onClose();
        } catch (error) {
          host.failed({ error, fallbackTitle: "Couldn't push to the replicas" });
        }
      }}
    />
  );
};
