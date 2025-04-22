import { Box, Text } from "@chakra-ui/react";

import { PromptConfigForm } from "./forms/PromptConfigForm";
import { usePromptConfigForm } from "./hooks/usePromptConfigForm";
import { PanelHeader } from "./ui/PanelHeader";

import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

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
  const { project } = useOrganizationTeamProject();
  const { data: llmConfig } = api.llmConfigs.getByIdWithLatestVersion.useQuery(
    {
      id: configId,
      projectId: project?.id ?? "",
    },
    { enabled: !!project?.id && !!configId }
  );
  const formProps = usePromptConfigForm({
    configId,
    projectId: project?.id ?? "",
    initialConfigValues: {
      name: llmConfig?.name,
      version: llmConfig?.latestVersion,
    },
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
      <PanelHeader
        title={<Text>Prompt Configuration</Text>}
        onClose={onClose}
      />
      <PromptConfigForm {...formProps} />
    </Box>
  );
}
