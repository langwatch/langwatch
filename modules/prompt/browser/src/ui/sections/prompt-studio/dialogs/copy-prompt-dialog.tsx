/**
 * The Replicate action on a published prompt. `useProjectsForCopy` did not
 * travel (it read `~/server/api/rbac`); the host answers `copyTargets()`
 * instead. Like the agents dialog, it does not close itself on failure.
 */

import { useState } from "react";
import { promptApi } from "../../../../behavior/prompt-api.ts";
import { usePromptProject } from "../../../../behavior/use-prompt-project.ts";
import { usePromptHost } from "../../../../model/prompt-host.ts";
import { PromptReplicateDialog } from "../../../../ui/blocks/prompt-replicate-dialog.tsx";

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
  const { project } = usePromptProject();
  const host = usePromptHost();
  const copyPrompt = promptApi.prompts.copy.useMutation();
  const [isCopying, setIsCopying] = useState(false);

  if (!project) return null;

  const projects = host.copyTargets().map((target) => ({
    value: target.id,
    label: target.teamName ? `${target.teamName} / ${target.name}` : target.name,
    hasCreatePermission: true,
  }));

  return (
    <PromptReplicateDialog
      open={open}
      promptName={promptName}
      projects={projects}
      isLoading={isCopying || copyPrompt.isPending}
      onClose={onClose}
      onCopy={async (targetProjectId) => {
        setIsCopying(true);
        try {
          await copyPrompt.mutateAsync({
            idOrHandle: promptId,
            projectId: targetProjectId,
            sourceProjectId: project.id,
          });
          host.succeeded({
            title: "Prompt replicated",
            description: `Prompt "${promptName}" replicated successfully.`,
          });
          onSuccess?.();
          onClose();
        } catch (error) {
          host.failed({ error, fallbackTitle: "Couldn't replicate the prompt" });
        } finally {
          setIsCopying(false);
        }
      }}
    />
  );
};
