import { Button, HStack, Text, VStack, useDisclosure } from "@chakra-ui/react";
import { Book, ChevronDown } from "react-feather";
import { Dialog } from "../../../../components/ui/dialog";
import { useOrganizationTeamProject } from "../../../../hooks/useOrganizationTeamProject";
import { api } from "../../../../utils/api";
import { toaster } from "../../../../components/ui/toaster";

interface PromptSourceProps {
  configId?: string; // Selected prompt ID
  onSelect: (config: { id: string; name: string }) => void;
}

// Prompt Selection Button Component
interface PromptSelectionButtonProps {
  selectedConfig: any;
  onClick: () => void;
}

function PromptSelectionButton({
  selectedConfig,
  onClick,
}: PromptSelectionButtonProps) {
  return (
    <Button
      onClick={onClick}
      width="full"
      justifyContent="space-between"
      variant="outline"
    >
      <HStack width="full" justifyContent="space-between">
        <HStack>
          <Book size={16} />
          <Text>
            {selectedConfig ? selectedConfig.name : "Select a prompt"}
          </Text>
        </HStack>
        <ChevronDown size={16} />
      </HStack>
    </Button>
  );
}

// Prompt List Item Component
interface PromptListItemProps {
  prompt: any;
  onSelect: (promptId: string) => void;
}

function PromptListItem({ prompt, onSelect }: PromptListItemProps) {
  return (
    <Button
      key={prompt.id}
      variant="ghost"
      justifyContent="flex-start"
      onClick={() => onSelect(prompt.id)}
      height="auto"
      py={2}
    >
      <HStack gap={3} width="full">
        <Book size={16} />
        <VStack align="start" gap={0}>
          <Text fontWeight="medium">{prompt.name}</Text>
          <Text fontSize="xs" color="gray.500">
            Updated: {new Date(prompt.updatedAt).toLocaleDateString()}
          </Text>
        </VStack>
      </HStack>
    </Button>
  );
}

// Prompt List Component
interface PromptListProps {
  isLoading: boolean;
  promptConfigs: any[] | undefined;
  onSelect: (promptId: string) => void;
}

function PromptList({ isLoading, promptConfigs, onSelect }: PromptListProps) {
  if (isLoading) {
    return <Text>Loading prompts...</Text>;
  }

  if (!promptConfigs || promptConfigs.length === 0) {
    return (
      <Text>No prompts found. Create one in the prompt library first.</Text>
    );
  }

  return (
    <VStack align="stretch" gap={1}>
      {promptConfigs.map((prompt) => (
        <PromptListItem key={prompt.id} prompt={prompt} onSelect={onSelect} />
      ))}
    </VStack>
  );
}

const usePrompSourceController = ({
  configId,
  onSelect,
}: PromptSourceProps) => {
  const { open, onOpen, onClose } = useDisclosure();
  const { project } = useOrganizationTeamProject();

  const { data: selectedConfig } = api.llmConfigs.getPromptConfigById.useQuery(
    {
      id: configId ?? "",
      projectId: project?.id ?? "",
    },
    { enabled: !!configId && !!project?.id }
  );

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

  // Handle prompt selection
  const handleSelectPrompt = (promptId: string) => {
    const selectedPrompt = promptConfigs?.find((p) => p.id === promptId);

    if (!selectedPrompt || !project?.id) return;

    onSelect({
      id: selectedPrompt.id,
      name: selectedPrompt.name,
    });
  };

  return {
    isLoading,
    promptConfigs,
    handleSelectPrompt,
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
