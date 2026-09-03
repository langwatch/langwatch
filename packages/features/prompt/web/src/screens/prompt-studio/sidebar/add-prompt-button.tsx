import { LuPlus } from "react-icons/lu";
import { PageLayout } from "@langwatch/design-system/page-layout";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { usePromptProject } from "../../../behavior/use-prompt-project";
import { usePromptHost } from "../../../model/prompt-host";
import { useCreateDraftPrompt } from "../../../behavior/use-create-draft-prompt";

interface AddPromptButtonProps {
  iconOnly?: boolean;
}

/**
 * AddPromptButton
 * Single Responsibility: Renders a button to create a new draft prompt.
 * Checks RBAC permissions first; if the check fails, shows the
 * restriction modal instead of creating the draft.
 */
export function AddPromptButton({ iconOnly }: AddPromptButtonProps) {
  const { createDraftPrompt } = useCreateDraftPrompt();
  const { hasPermission } = usePromptProject();
  // `platform/app` opened the restriction modal from a module-level zustand
  // store the whole application shares; a package may not reach it, so the host
  // is asked to offer the upgrade instead.
  const host = usePromptHost();

  const handleClick = () => {
    if (!hasPermission("prompts:create")) {
      host.requestUpgrade();
      return;
    }
    void createDraftPrompt();
  };

  return (
    <Tooltip content="New Prompt" disabled={!iconOnly}>
      <PageLayout.HeaderButton onClick={handleClick}>
        <LuPlus size={14} />
        {!iconOnly && "New Prompt"}
      </PageLayout.HeaderButton>
    </Tooltip>
  );
}
