import { LuPlus } from "react-icons/lu";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { Tooltip } from "~/components/ui/tooltip";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useProjectAcceptsWrites } from "~/hooks/useProjectAcceptsWrites";
import { useUpgradeModalStore } from "~/stores/upgradeModalStore";
import { useCreateDraftPrompt } from "../../hooks/useCreateDraftPrompt";

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
  const { hasPermission } = useOrganizationTeamProject();
  const acceptsWrites = useProjectAcceptsWrites();
  const openLiteMemberRestriction = useUpgradeModalStore(
    (state) => state.openLiteMemberRestriction,
  );

  const handleClick = () => {
    if (!hasPermission("prompts:create")) {
      openLiteMemberRestriction({ resource: "prompts" });
      return;
    }
    void createDraftPrompt();
  };

  // An aggregate (ADR-144) keeps no prompts of its own; offering one there
  // would only end in the server's refusal.
  if (!acceptsWrites) return null;

  return (
    <Tooltip content="New Prompt" disabled={!iconOnly}>
      <PageLayout.HeaderButton onClick={handleClick}>
        <LuPlus size={14} />
        {!iconOnly && "New Prompt"}
      </PageLayout.HeaderButton>
    </Tooltip>
  );
}
