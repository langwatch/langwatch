import { Plus } from "react-feather";
import { Button } from "@chakra-ui/react";
import { useCreateDraftPrompt } from "../../hooks/useCreateDraftPrompt";
import { useCallback } from "react";

export function AddPromptButton() {
  const { createDraftPrompt } = useCreateDraftPrompt();
  return (
    <Button onClick={() => void createDraftPrompt()}>
      <Plus size={14} />
    </Button>
  );
}
