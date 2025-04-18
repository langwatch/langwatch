import { VStack, useDisclosure } from "@chakra-ui/react";
import { useMemo } from "react";

import { PromptList } from "./ui/PromptList";
import { PromptSelectionButton } from "./ui/PromptSelectButton";

import { Dialog } from "~/components/ui/dialog";
import { toaster } from "~/components/ui/toaster";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
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
    <>
      <PromptSelectionButton selectedConfig={selectedConfig} onClick={onOpen} />

      <Dialog.Root
        open={open}
        onOpenChange={({ open }) => (open ? onOpen() : onClose())}
      >
        <Dialog.Content>
          <Dialog.Header>
            <Dialog.Title>Select a Prompt</Dialog.Title>
            <Dialog.CloseTrigger />
          </Dialog.Header>
          <Dialog.Body>
            <VStack align="stretch" gap={4} width="full">
              <PromptList
                isLoading={isLoading}
                promptConfigs={promptConfigs}
                onSelect={handleSelectPrompt}
              />
            </VStack>
          </Dialog.Body>
        </Dialog.Content>
      </Dialog.Root>
    </>
  );
}

export function PromptSource({ configId, onSelect }: PromptSourceProps) {
  const controller = usePrompSourceController({
    configId,
    onSelect,
  });

  return <PromptSourceSelect {...controller} />;
}
