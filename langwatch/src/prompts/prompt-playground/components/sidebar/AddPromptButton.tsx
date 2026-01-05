import { Button } from "@chakra-ui/react";
import { LuPlus } from "react-icons/lu";
import { useCreateDraftPrompt } from "../../hooks/useCreateDraftPrompt";
import { PageLayout } from "~/components/ui/layouts/PageLayout";

/**
 * AddPromptButton
 * Single Responsibility: Renders a button to create a new draft prompt.
 */
export function AddPromptButton() {
  const { createDraftPrompt } = useCreateDraftPrompt();
  return (
    <PageLayout.HeaderButton
      onClick={() => void createDraftPrompt()}
    >
      <LuPlus size={14} />
      New Prompt
    </PageLayout.HeaderButton>
  );
}
