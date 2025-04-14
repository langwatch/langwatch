import { Box, HStack, Separator, Text } from "@chakra-ui/react";
import {
  VersionHistoryItem,
  VersionHistoryListPopover,
} from "./VersionHistoryListPopover";
import { PanelHeader } from "./ui/PanelHeader";
import { PromptForm } from "./forms/PromptForm";
import { PromptConfigVersionForm } from "./forms/PromptConfigVersionForm";

interface PromptConfigPanelProps {
  isOpen: boolean;
  onClose: () => void;
  config: any;
}

export function PromptConfigPanel({
  isOpen,
  onClose,
  config,
}: PromptConfigPanelProps) {
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
      <PromptForm
        initialValues={config}
        onSubmit={(values) => {
          console.log(values);
        }}
      />
      <PromptConfigVersionForm
        initialValues={config}
        onSubmit={(values) => {
          console.log(values);
        }}
        isSubmitting={false}
      />
    </Box>
  );
}
