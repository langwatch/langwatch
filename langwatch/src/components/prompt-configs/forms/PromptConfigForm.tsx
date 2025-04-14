import { HStack, Button, Spinner } from "@chakra-ui/react";
import { FormProvider } from "react-hook-form";
import { PromptNameField } from "./fields/PromptNameField";
import { CommitMessageField } from "./fields/CommitMessageField";
import { VersionHistoryListPopover } from "../VersionHistoryListPopover";
import { SaveIcon } from "lucide-react";
import { usePromptConfigForm } from "../hooks/usePromptConfigForm";
import { PromptConfigVersionFieldGroup } from "./fields/PromptConfigVersionFieldGroup";

interface PromptConfigFormProps {
  configId: string;
}

export function PromptConfigForm({ configId }: PromptConfigFormProps) {
  const { methods, handleSubmit, isLoading, isSubmitting } =
    usePromptConfigForm({
      configId,
    });

  if (isLoading) {
    return null;
  }

  const formIsDirty = methods.formState.isDirty;

  return (
    <FormProvider {...methods}>
      <form>
        <PromptNameField />
        <PromptConfigVersionFieldGroup />
        <HStack
          marginTop={4}
          marginBottom={6}
          justify="space-between"
          width="full"
        >
          <CommitMessageField />
          <Button
            type="submit"
            colorPalette={formIsDirty ? "orange" : "gray"}
            aria-label="Save"
            marginTop={9}
            disabled={!formIsDirty}
            onClick={(e) => {
              e.preventDefault();
              handleSubmit();
            }}
          >
            {isSubmitting ? <Spinner /> : <SaveIcon />}
            Save Version
          </Button>
        </HStack>
        <HStack>
          <VersionHistoryListPopover configId={configId} />
        </HStack>
      </form>
    </FormProvider>
  );
}
