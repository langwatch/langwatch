import { Button, HStack, Text, VStack } from "@chakra-ui/react";
import { Book } from "react-feather";

// Prompt List Component
interface PromptListProps {
  isLoading: boolean;
  promptConfigs: {
    id: string;
    name: string;
    latestVersion: {
      version: number;
      commitMessage: string;
    };
    updatedAt: Date;
  }[];
  onSelect: (promptId: string) => void;
}

export function PromptList({
  isLoading,
  promptConfigs,
  onSelect,
}: PromptListProps) {
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

// Prompt List Item Component
interface PromptListItemProps {
  prompt: {
    id: string;
    name: string;
    latestVersion: {
      version: number;
    };
    updatedAt: Date;
  };
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
      width="full"
    >
      <HStack gap={3} width="full">
        <Book size={16} />
        <VStack align="start" gap={0} width="full">
          <Text fontWeight="medium" lineClamp={1}>
            {prompt.name}
          </Text>
          <HStack width="full">
            <Text fontSize="xs" color="gray.500">
              Updated: {new Date(prompt.updatedAt).toLocaleDateString()}
            </Text>
            <Text fontSize="xs" fontWeight="medium" color="gray.600">
              (v{prompt.latestVersion.version})
            </Text>
          </HStack>
        </VStack>
      </HStack>
    </Button>
  );
}
