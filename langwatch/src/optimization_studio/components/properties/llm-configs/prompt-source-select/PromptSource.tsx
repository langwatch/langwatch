import { HStack, Button, useDisclosure } from "@chakra-ui/react";
import { useMemo } from "react";
import { Save } from "react-feather";

import { PromptList } from "./ui/PromptList";
import { PromptSelectionButton } from "./ui/PromptSelectButton";
import { PromptSourceDialog } from "./ui/PromptSourceDialog";

import { toaster } from "~/components/ui/toaster";
import { VerticalFormControl } from "~/components/VerticalFormControl";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { VersionHistoryListPopover } from "~/prompt-configs/VersionHistoryListPopover";
import { api } from "~/utils/api";

interface PromptSourceProps {
  configId?: string; // Selected prompt ID
  onSelect: (config: { id: string; name: string }) => void;
}

const usePrompSourceController = ({
  configId,
  onSelect,
}: PromptSourceProps) => {
  const { open, onOpen, onClose } = useDisclosure();
  const { project } = useOrganizationTeamProject();

  // Fetch all prompt configs
  const { data: promptConfigs, isLoading } =
    api.llmConfigs.getPromptConfigs.useQuery(
      {
        projectId: project?.id ?? "",
      },
      {
        enabled: !!project?.id,
        onError: (error) => {
          toaster.create({
            title: "Error loading prompt configs",
            description: error.message,
            type: "error",
          });
        },
      }
    );

  const promptConfigsWithName = useMemo(
    () =>
      (promptConfigs ?? []).map((p) => ({
        id: p.id,
        name: `${p.name} - ${p.latestVersion.commitMessage}`,
        latestVersion: p.latestVersion,
        updatedAt: p.updatedAt,
      })),
    [promptConfigs]
  );

  const selectedConfig = useMemo(
    () => promptConfigsWithName.find((p) => p.id === configId),
    [promptConfigsWithName, configId]
  );

  // Handle prompt selection
  const handleSelectPrompt = (promptId: string) => {
    const selectedPrompt = promptConfigs?.find((p) => p.id === promptId);

    if (!selectedPrompt || !project?.id) return;

    onSelect({
      id: selectedPrompt.id,
      name: selectedPrompt.name,
    });

    onClose();
  };

  return {
    isLoading,
    handleSelectPrompt,
    promptConfigs: promptConfigsWithName,
    selectedConfig,
    open,
    onOpen,
    onClose,
  };
};

export function PromptSourceSelect({
  isLoading,
  promptConfigs,
  handleSelectPrompt,
  selectedConfig,
  open,
  onOpen,
  onClose,
}: ReturnType<typeof usePrompSourceController>) {
  return (
    <VerticalFormControl label="Prompt Source" width="full">
      <HStack width="full" justifyContent="space-between">
        <HStack flex={1} width="50%">
          <PromptSelectionButton
            onClick={onOpen}
            selectedConfig={selectedConfig}
          />
        </HStack>
        {selectedConfig && (
          <Button variant="outline" marginLeft={2}>
            <VersionHistoryListPopover configId={selectedConfig.id} />
          </Button>
        )}
        <Button variant="outline">
          <Save />
        </Button>
      </HStack>

      <PromptSourceDialog open={open} onOpen={onOpen} onClose={onClose}>
        <PromptList
          isLoading={isLoading}
          promptConfigs={promptConfigs}
          onSelect={handleSelectPrompt}
        />
      </PromptSourceDialog>
    </VerticalFormControl>
  );
}

export function PromptSource({ configId, onSelect }: PromptSourceProps) {
  const controller = usePrompSourceController({
    configId,
    onSelect,
  });

  return <PromptSourceSelect {...controller} />;
}
