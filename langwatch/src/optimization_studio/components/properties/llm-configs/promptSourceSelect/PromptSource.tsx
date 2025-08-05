import { useDisclosure } from "@chakra-ui/react";
import { useMemo } from "react";

import { PromptList } from "./ui/PromptList";
import { PromptSelectionButton } from "./ui/PromptSelectButton";
import { PromptSourceDialog } from "./ui/PromptSourceDialog";

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
      (promptConfigs ?? [])
        .filter((p) => p.handle)
        .map((p) => ({
          id: p.id,
          name: (p.handle == p.id ? p.name : p.handle) ?? "",
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
      <PromptSelectionButton onClick={onOpen} selectedConfig={selectedConfig} />

      <PromptSourceDialog open={open} onOpen={onOpen} onClose={onClose}>
        <PromptList
          isLoading={isLoading}
          promptConfigs={promptConfigs}
          onSelect={handleSelectPrompt}
        />
      </PromptSourceDialog>
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
