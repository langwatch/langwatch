import { HStack, Text, Button } from "@chakra-ui/react";
import { FormProvider } from "react-hook-form";
import { PromptNameField } from "./fields/PromptNameField";
import { CommitMessageField } from "./fields/CommitMessageField";
import { VersionHistoryListPopover } from "../VersionHistoryListPopover";
import { SaveIcon, HistoryIcon } from "lucide-react";
import { usePromptConfigForm } from "../hooks/usePromptConfigForm";
import { PromptConfigVersionFieldGroup } from "./fields/PromptConfigVersionFieldGroup";

interface PromptConfigFormProps {
  configId: string;
}

export function PromptConfigForm({ configId }: PromptConfigFormProps) {
  const { methods, handleSubmit, isLoading } = usePromptConfigForm({
    configId,
  });

  if (isLoading) {
    return null;
  }

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
            colorScheme="gray"
            aria-label="Save"
            marginTop={9}
            onClick={(e) => {
              e.preventDefault();
              handleSubmit();
            }}
          >
            <SaveIcon />
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
