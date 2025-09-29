import { useDisclosure } from "@chakra-ui/react";

import { PromptList } from "./ui/PromptList";
import { PromptSelectionButton } from "./ui/PromptSelectButton";
import { PromptSourceDialog } from "./ui/PromptSourceDialog";

import { toaster } from "~/components/ui/toaster";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

interface PromptSourceProps {
  selectedPromptId: string;
  onSelect: (config: { id: string; name: string }) => void;
}

const usePrompSourceController = ({
  onSelect,
  selectedPromptId,
}: PromptSourceProps) => {
  const { open, onOpen, onClose } = useDisclosure();
  const { project } = useOrganizationTeamProject();

  // Fetch all prompt configs
  const { data: prompts = [], isLoading } =
    api.prompts.getAllPromptsForProject.useQuery(
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

  // Handle prompt selection
  const handleSelectPrompt = (promptId: string) => {
    const selectedPrompt = prompts?.find((p) => p.id === promptId);

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
    prompts,
    open,
    onOpen,
    onClose,
    selectedPromptId,
  };
};

export function PromptSourceSelect({
  isLoading,
  prompts,
  handleSelectPrompt,
  open,
  onOpen,
  onClose,
  selectedPromptId,
}: ReturnType<typeof usePrompSourceController>) {
  return (
    <>
      <PromptSelectionButton onClick={onOpen} />

      <PromptSourceDialog open={open} onOpen={onOpen} onClose={onClose}>
        <PromptList
          isLoading={isLoading}
          prompts={prompts}
          onSelect={handleSelectPrompt}
          selectedPromptId={selectedPromptId}
        />
      </PromptSourceDialog>
    </>
  );
}

export function PromptSource({ selectedPromptId, onSelect }: PromptSourceProps) {
  const controller = usePrompSourceController({
    selectedPromptId,
    onSelect,
  });

  return <PromptSourceSelect {...controller} />;
}
