import { PageLayout } from "@langwatch/design-system/page-layout";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { isAggregateProjectKind } from "@langwatch/project-contract";
import { LuPlus } from "react-icons/lu";

import { useCreateDraftPrompt } from "../../../../behavior/use-create-draft-prompt.ts";
import { usePromptProject } from "../../../../behavior/use-prompt-project.ts";
import { usePromptHost } from "../../../../model/prompt-host.ts";

interface AddPromptButtonProps {
  iconOnly?: boolean;
}

/**
 * Renders a button to create a new draft prompt. Checks RBAC permissions
 * first; on failure shows the restriction modal instead of creating the draft.
 */
export function AddPromptButton({ iconOnly }: AddPromptButtonProps) {
  const { createDraftPrompt } = useCreateDraftPrompt();
  const { project, hasPermission } = usePromptProject();
  // The restriction modal belongs to the shell, so the host is asked to offer
  // the upgrade.
  const host = usePromptHost();

  const handleClick = () => {
    if (!hasPermission("prompts:create")) {
      host.requestUpgrade();
      return;
    }
    void createDraftPrompt();
  };

  // An aggregate (ADR-177) keeps no prompts of its own; offering one there
  // would only end in the server's refusal.
  if (isAggregateProjectKind(project?.kind)) return null;

  return (
    <Tooltip content="New Prompt" disabled={!iconOnly}>
      <PageLayout.HeaderButton primary onClick={handleClick} data-testid="prompt-new-button">
        <LuPlus size={14} />
        {!iconOnly && "New Prompt"}
      </PageLayout.HeaderButton>
    </Tooltip>
  );
}
