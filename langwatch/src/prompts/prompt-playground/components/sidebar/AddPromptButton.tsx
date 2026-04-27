import { LuPlus } from "react-icons/lu";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { Tooltip } from "~/components/ui/tooltip";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useLicenseEnforcement } from "~/hooks/useLicenseEnforcement";
import { useUpgradeModalStore } from "~/stores/upgradeModalStore";
import { useCreateDraftPrompt } from "../../hooks/useCreateDraftPrompt";

interface AddPromptButtonProps {
  iconOnly?: boolean;
}

/**
 * AddPromptButton
 * Single Responsibility: Renders a button to create a new draft prompt.
 * Uses click-then-modal pattern: checks RBAC permissions first,
 * then license limits. If either check fails, shows the appropriate modal
 * instead of creating the draft.
 */
export function AddPromptButton({ iconOnly }: AddPromptButtonProps) {
  const { createDraftPrompt } = useCreateDraftPrompt();
  const { checkAndProceed } = useLicenseEnforcement("prompts");
  const { hasPermission } = useOrganizationTeamProject();
  const openLiteMemberRestriction = useUpgradeModalStore(
    (state) => state.openLiteMemberRestriction,
  );

  const handleClick = () => {
    if (!hasPermission("prompts:create")) {
      openLiteMemberRestriction({ resource: "prompts" });
      return;
    }
    checkAndProceed(() => {
      void createDraftPrompt();
    });
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
