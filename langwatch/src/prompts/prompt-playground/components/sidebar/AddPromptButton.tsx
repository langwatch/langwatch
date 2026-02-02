import { LuPlus } from "react-icons/lu";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { Tooltip } from "~/components/ui/tooltip";
import { useLicenseEnforcement } from "~/hooks/useLicenseEnforcement";
import { useCreateDraftPrompt } from "../../hooks/useCreateDraftPrompt";

interface AddPromptButtonProps {
  iconOnly?: boolean;
}

/**
 * AddPromptButton
 * Single Responsibility: Renders a button to create a new draft prompt.
 * Uses click-then-modal pattern for license enforcement.
 */
export function AddPromptButton({ iconOnly }: AddPromptButtonProps) {
  const { createDraftPrompt } = useCreateDraftPrompt();
  const { checkAndProceed } = useLicenseEnforcement("prompts");

  const handleClick = () => {
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
