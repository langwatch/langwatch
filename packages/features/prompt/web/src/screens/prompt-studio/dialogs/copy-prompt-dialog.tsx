/**
 * The Replicate action on a published prompt.
 *
 * `useProjectsForCopy` did not travel: it read `~/server/api/rbac`, which a
 * browser package may not name. The host answers `copyTargets()` instead, built
 * in `apps/ui` over `@langwatch/authz-contract`'s published rules — the same
 * answer the agents and datasets families rebuilt for their own pickers, and
 * the third time that rbac import comes off a gate list for a picker.
 *
 * Like the agents dialog, this one does not close itself on failure: the
 * refusal is handed to the host and the reader keeps the dialog they were in.
 */

import { useState } from "react";
import { promptApi } from "../../../behavior/prompt-api";
import { usePromptProject } from "../../../behavior/use-prompt-project";
import { usePromptHost } from "../../../model/prompt-host";
import { PromptReplicateDialog } from "../../../ui/blocks/prompt-replicate-dialog";

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
