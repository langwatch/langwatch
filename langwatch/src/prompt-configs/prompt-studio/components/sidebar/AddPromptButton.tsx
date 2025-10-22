import { Plus } from "react-feather";
import { Button } from "@chakra-ui/react";
import { useCreateDraftPrompt } from "../../hooks/useCreateDraftPrompt";
import { useCallback } from "react";
import { toaster } from "~/components/ui/toaster";

export function AddPromptButton() {
  const { createDraftPrompt } = useCreateDraftPrompt();
  const handleCreateDraftPrompt = useCallback(() => {
    void createDraftPrompt({
      onSuccess: (args) => {
        console.log(args);
      },
      onError: (error) => {
        toaster.create({
          title: "Error creating draft prompt",
          description: error.message,
          type: "error",
          closable: true,
        });
      },
    });
  }, [createDraftPrompt]);
  return (
    <Button onClick={handleCreateDraftPrompt}>
      <Plus size={14} />
    </Button>
  );
}
