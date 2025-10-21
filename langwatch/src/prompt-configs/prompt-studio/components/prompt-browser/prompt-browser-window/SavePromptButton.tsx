import { Button } from "@chakra-ui/react";
import { useFormContext } from "react-hook-form";
import { useHandleSavePrompt } from "~/prompt-configs/prompt-studio/hooks/useHandleSavePrompt";
import type { PromptConfigFormValues } from "~/prompt-configs";

export function SavePromptButton() {
  const formMethods = useFormContext<PromptConfigFormValues>();
  const { handleSaveVersion } = useHandleSavePrompt();
  const handle = formMethods.watch("handle");
  const isDraft = !Boolean(handle);
  const isDirty = formMethods.formState.isDirty;
  const saveEnabled = isDirty || isDraft;

  return (
    <Button
      onClick={handleSaveVersion}
      disabled={!saveEnabled}
      variant="outline"
    >
      {saveEnabled ? "Save" : "Saved"}
    </Button>
  );
}
