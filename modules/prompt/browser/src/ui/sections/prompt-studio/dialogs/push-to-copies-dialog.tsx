/**
 * The Push-to-replicas action on a published prompt. The generic
 * `PushToCopiesDialog` did not travel (toaster/`HandledErrorAlert`), so this
 * wraps it and tells the host. The replicas list arrives pre-filtered by the server.
 */

import { useState } from "react";

import { promptApi } from "../../../../behavior/prompt-api.ts";
import { usePromptProject } from "../../../../behavior/use-prompt-project.ts";
import { usePromptHost } from "../../../../model/prompt-host.ts";
import { PromptPushDialog, type PromptCopyItem } from "../../../blocks/prompt-push-dialog.tsx";

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
  const [editedCopyIds, setEditedCopyIds] = useState<Set<string> | null>(null);

  const {
    data: copies,
    isLoading,
    error,
  } = promptApi.prompts.getCopies.useQuery(
    { projectId: project?.id ?? "", idOrHandle: promptId },
    { enabled: open && !!project?.id && !!promptId },
  );

  const availableCopies: PromptCopyItem[] = copies ?? [];
  const selectedCopyIds = editedCopyIds ?? new Set(availableCopies.map((copy) => copy.id));

  const handleToggleCopy = (copyId: string) => {
    const next = new Set(selectedCopyIds);
    if (next.has(copyId)) next.delete(copyId);
    else next.add(copyId);
    setEditedCopyIds(next);
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
          setEditedCopyIds(new Set());
          onClose();
        } catch (error) {
          host.failed({ error, fallbackTitle: "Couldn't push to the replicas" });
        }
      }}
    />
  );
};
