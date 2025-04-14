import { Box, HStack, Text, Button } from "@chakra-ui/react";
import { PanelHeader } from "./ui/PanelHeader";
import { PromptConfigVersionFieldGroup } from "./forms/PromptConfigVersionFieldGroup";
import { FormProvider } from "react-hook-form";
import { PromptNameField } from "./forms/fields/PromptNameField";
import { CommitMessageField } from "./forms/fields/CommitMessageField";
import { VersionHistoryListPopover } from "./VersionHistoryListPopover";
import { SaveIcon } from "lucide-react";
import { usePromptConfigForm } from "./hooks/usePromptConfigForm";

interface PromptConfigPanelProps {
  isOpen: boolean;
  onClose: () => void;
  configId: string;
}

export function PromptConfigPanel({
  isOpen,
  onClose,
  configId,
}: PromptConfigPanelProps) {
  const { methods, handleSubmit } = usePromptConfigForm({
    configId,
  });

  if (!isOpen) {
    return null;
  }

  return (
    <Box
      position="absolute"
      top={0}
      right={0}
      height="full"
      background="white"
      border="1px solid"
      borderColor="var(--chakra-colors-gray-350)"
      borderTopWidth={0}
      borderBottomWidth={0}
      borderRightWidth={0}
      zIndex={100}
      overflowY="auto"
      padding={6}
      minWidth="600px"
    >
      <PanelHeader title="Prompt Configuration" onClose={onClose} />
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
            <VersionHistoryListPopover />
            <Text>Prompt Version History</Text>
          </HStack>
        </form>
      </FormProvider>
    </Box>
  );
}
