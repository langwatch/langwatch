import { Button, HStack, Text, VStack } from "@chakra-ui/react";
import { Book } from "react-feather";
import { formatTimeAgo } from "../../../../../../utils/formatTimeAgo";

// Prompt List Component
interface PromptListProps {
  isLoading: boolean;
  prompts: PromptListItemProps['prompt'][];
  selectedPromptId: string;
  onSelect: (promptId: string) => void;
}

export function PromptList({
  isLoading,
  prompts,
  selectedPromptId,
  onSelect,
}: PromptListProps) {
  if (isLoading) {
    return <Text>Loading prompts...</Text>;
  }

  if (!prompts || prompts.length === 0) {
    return (
      <Text>No prompts found. Create one in the prompt library first.</Text>
    );
  }

  return (
    <VStack align="stretch" gap={1}>
      {prompts.map((prompt) => (
        <PromptListItem key={prompt.id} prompt={prompt} onSelect={onSelect} isSelected={selectedPromptId === prompt.id} />
      ))}
    </VStack>
  );
}

// Prompt List Item Component
interface PromptListItemProps {
  isSelected: boolean;
  prompt: {
    id: string;
    name: string;
    version: number;
    updatedAt: Date;
  };
  onSelect: (promptId: string) => void;
}

function PromptListItem({ prompt, onSelect, isSelected }: PromptListItemProps) {
  return (
    <Button
      key={prompt.id}
      variant="ghost"
      justifyContent="flex-start"
      onClick={() => onSelect(prompt.id)}
      height="auto"
      py={2}
      width="full"
      bg={isSelected ? "gray.100" : "transparent"}
    >
      <HStack gap={3} width="full">
        <Book size={16} />
        <VStack align="start" gap={0} width="full">
          <Text fontWeight="medium" lineClamp={1}>
            {prompt.name}
          </Text>
          <HStack width="full">
            <Text fontSize="xs" color="gray.500">
              Updated: {formatTimeAgo(prompt.updatedAt.getTime())}
            </Text>
            <Text fontSize="xs" fontWeight="medium" color="gray.600">
              (v{prompt.version})
            </Text>
          </HStack>
        </VStack>
      </HStack>
    </Button>
  );
}
