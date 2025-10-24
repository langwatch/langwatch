import { Plus } from "react-feather";
import { Button } from "@chakra-ui/react";
import { useCreateDraftPrompt } from "../../hooks/useCreateDraftPrompt";

export function AddPromptButton() {
  const { createDraftPrompt } = useCreateDraftPrompt();
  return (
    <Button onClick={() => void createDraftPrompt()} size="xs" variant="ghost">
      <Plus size={14} />
    </Button>
  );
}
