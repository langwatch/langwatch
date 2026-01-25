import { LuPlus } from "react-icons/lu";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { Tooltip } from "~/components/ui/tooltip";
import { useCreateDraftPrompt } from "../../hooks/useCreateDraftPrompt";

interface AddPromptButtonProps {
  iconOnly?: boolean;
}

/**
 * AddPromptButton
 * Single Responsibility: Renders a button to create a new draft prompt.
 */
export function AddPromptButton({ iconOnly }: AddPromptButtonProps) {
  const { createDraftPrompt } = useCreateDraftPrompt();
  return (
    <Tooltip content="New Prompt" disabled={!iconOnly}>
      <PageLayout.HeaderButton onClick={() => void createDraftPrompt()}>
        <LuPlus size={14} />
        {!iconOnly && "New Prompt"}
      </PageLayout.HeaderButton>
    </Tooltip>
  );
}
