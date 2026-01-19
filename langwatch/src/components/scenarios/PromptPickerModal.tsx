import {
  Box,
  Button,
  HStack,
  Input,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { BookText, Plus, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRecentTargets } from "../../hooks/useRecentTargets";
import { useAllPromptsForProject } from "../../prompts/hooks/useAllPromptsForProject";
import { Dialog } from "../ui/dialog";

interface PromptPickerModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (promptId: string) => void;
  onCreateNew: () => void;
}

/**
 * Modal for selecting a prompt to run a scenario against.
 * Shows recent prompts, search, and all prompts list.
 */
export function PromptPickerModal({
  open,
  onClose,
  onSelect,
  onCreateNew,
}: PromptPickerModalProps) {
  const { data: prompts, isLoading } = useAllPromptsForProject();
  const { recentPromptIds } = useRecentTargets();
  const [searchValue, setSearchValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus search input when modal opens
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 0);
    } else {
      setSearchValue("");
    }
  }, [open]);

  // Filter to published prompts only (version > 0)
  const publishedPrompts = useMemo(() => {
    return prompts?.filter((p) => p.version > 0) ?? [];
  }, [prompts]);

  // Get recent prompts that still exist
  const recentPrompts = useMemo(() => {
    return recentPromptIds
      .map((id) => publishedPrompts.find((p) => p.id === id))
      .filter(Boolean) as typeof publishedPrompts;
  }, [recentPromptIds, publishedPrompts]);

  // Filter by search
  const filteredPrompts = useMemo(() => {
    if (!searchValue) return publishedPrompts;
    return publishedPrompts.filter((p) =>
      (p.handle ?? p.id).toLowerCase().includes(searchValue.toLowerCase()),
    );
  }, [publishedPrompts, searchValue]);

  // Filter recent by search too
  const filteredRecent = useMemo(() => {
    if (!searchValue) return recentPrompts;
    return recentPrompts.filter((p) =>
      (p.handle ?? p.id).toLowerCase().includes(searchValue.toLowerCase()),
    );
  }, [recentPrompts, searchValue]);

  const handleSelect = (promptId: string) => {
    onSelect(promptId);
    onClose();
  };

  const handleCreateNew = () => {
    onCreateNew();
    onClose();
  };

  const hasPrompts = publishedPrompts.length > 0;
  const hasResults = filteredPrompts.length > 0;

  return (
    <Dialog.Root open={open} onOpenChange={(e) => !e.open && onClose()}>
      <Dialog.Content maxWidth="500px">
        <Dialog.Header>
          <Dialog.Title>Run with Prompt</Dialog.Title>
        </Dialog.Header>
        <Dialog.CloseTrigger />
        <Dialog.Body paddingX={0} paddingBottom={0}>
          {isLoading ? (
            <VStack padding={8}>
              <Spinner />
            </VStack>
          ) : !hasPrompts ? (
            // Empty state
            <VStack padding={8} gap={4}>
              <Box padding={4} borderRadius="full" backgroundColor="gray.100">
                <BookText size={32} color="var(--chakra-colors-gray-400)" />
              </Box>
              <Text fontWeight="medium" fontSize="lg">
                No prompts yet
              </Text>
              <Text color="gray.500" textAlign="center">
                Create a prompt to test your scenario against a prompt
                configuration.
              </Text>
              <Button
                colorPalette="blue"
                onClick={handleCreateNew}
                marginTop={2}
              >
                <Plus size={14} />
                Create new prompt
              </Button>
            </VStack>
          ) : (
            <VStack gap={0} align="stretch">
              {/* Search Input */}
              <Box paddingX={4} paddingBottom={3}>
                <Input
                  ref={inputRef}
                  size="sm"
                  placeholder="Search prompts..."
                  value={searchValue}
                  onChange={(e) => setSearchValue(e.target.value)}
                />
              </Box>

              {/* Scrollable Content */}
              <Box maxHeight="400px" overflowY="auto">
                {/* Recent Section */}
                {filteredRecent.length > 0 && (
                  <Box>
                    <Text
                      fontSize="xs"
                      fontWeight="bold"
                      textTransform="uppercase"
                      color="gray.500"
                      paddingX={4}
                      paddingY={2}
                      bg="gray.50"
                    >
                      Recent
                    </Text>
                    {filteredRecent.map((prompt) => (
                      <PromptRow
                        key={prompt.id}
                        name={prompt.handle ?? prompt.id}
                        model={prompt.defaultModelName ?? ""}
                        onClick={() => handleSelect(prompt.id)}
                      />
                    ))}
                  </Box>
                )}

                {/* All Prompts Section */}
                <Box>
                  <Text
                    fontSize="xs"
                    fontWeight="bold"
                    textTransform="uppercase"
                    color="gray.500"
                    paddingX={4}
                    paddingY={2}
                    bg="gray.50"
                  >
                    {searchValue ? "Search Results" : "All Prompts"}
                  </Text>
                  {!hasResults ? (
                    <Text
                      fontSize="sm"
                      color="gray.400"
                      paddingX={4}
                      paddingY={3}
                    >
                      No prompts found
                    </Text>
                  ) : (
                    filteredPrompts.map((prompt) => (
                      <PromptRow
                        key={prompt.id}
                        name={prompt.handle ?? prompt.id}
                        model={prompt.defaultModelName ?? ""}
                        onClick={() => handleSelect(prompt.id)}
                      />
                    ))
                  )}
                </Box>
              </Box>

              {/* Create New */}
              <Box
                borderTopWidth="1px"
                borderColor="gray.200"
                paddingX={4}
                paddingY={3}
              >
                <Button
                  variant="ghost"
                  size="sm"
                  colorPalette="blue"
                  onClick={handleCreateNew}
                  width="full"
                  justifyContent="flex-start"
                >
                  <Plus size={14} />
                  Create new prompt
                </Button>
              </Box>
            </VStack>
          )}
        </Dialog.Body>
        <Dialog.Footer borderTopWidth="1px">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}

interface PromptRowProps {
  name: string;
  model: string;
  onClick: () => void;
}

function PromptRow({ name, model, onClick }: PromptRowProps) {
  return (
    <HStack
      paddingX={4}
      paddingY={3}
      cursor="pointer"
      _hover={{ bg: "gray.50" }}
      onClick={onClick}
      gap={3}
    >
      <BookText size={16} color="var(--chakra-colors-gray-500)" />
      <Text fontSize="sm" flex={1}>
        {name}
      </Text>
      {model && (
        <Text fontSize="xs" color="gray.400">
          {model}
        </Text>
      )}
    </HStack>
  );
}
