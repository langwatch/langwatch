import { LuPlus } from "react-icons/lu";
import { Button } from "@chakra-ui/react";
import { useCreateDraftPrompt } from "../../hooks/useCreateDraftPrompt";

/**
 * AddPromptButton
 * Single Responsibility: Renders a button to create a new draft prompt.
 */
export function AddPromptButton() {
  const { createDraftPrompt } = useCreateDraftPrompt();
  return (
    <Button onClick={() => void createDraftPrompt()} size="xs" variant="ghost">
      <LuPlus size={14} />
    </Button>
  );
}
