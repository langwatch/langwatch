import { Box } from "@chakra-ui/react";
import { PanelHeader } from "./ui/PanelHeader";
import { PromptConfigForm } from "./forms/PromptConfigForm";
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
  const { isLoading } = usePromptConfigForm({
    configId,
  });

  if (!isOpen || isLoading) {
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
      <PromptConfigForm configId={configId} />
    </Box>
  );
}
