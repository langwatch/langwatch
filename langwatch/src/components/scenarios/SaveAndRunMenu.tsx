import { Box, Button, HStack, Input, Portal, Text } from "@chakra-ui/react";
import { BookText, ChevronDown, Globe, Play, Plus, Save } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { useAllPromptsForProject } from "../../prompts/hooks/useAllPromptsForProject";
import { api } from "../../utils/api";
import { Popover } from "../ui/popover";
import type { TargetValue } from "./TargetSelector";

interface SaveAndRunMenuProps {
  selectedTarget: TargetValue;
  onTargetChange: (target: TargetValue) => void;
  onSaveAndRun: (target: TargetValue) => void;
  onSaveWithoutRunning: () => void;
  onCreateAgent: () => void;
  onCreatePrompt?: () => void;
  isLoading?: boolean;
}

/**
 * Combined "Save and Run" dropdown menu with target selection.
 * Shows prompts and agents directly in the menu - clicking runs immediately.
 */
export function SaveAndRunMenu({
  selectedTarget,
  onTargetChange,
  onSaveAndRun,
  onSaveWithoutRunning,
  onCreateAgent,
  onCreatePrompt,
  isLoading = false,
}: SaveAndRunMenuProps) {
  const { project } = useOrganizationTeamProject();
  const { data: prompts } = useAllPromptsForProject();
  const { data: agents } = api.agents.getAll.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project?.id },
  );

  const [searchValue, setSearchValue] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Filter and sort prompts (only published ones with version > 0, sorted by updatedAt desc)
  const filteredPrompts = useMemo(() => {
    const publishedPrompts = prompts?.filter((p) => p.version > 0) ?? [];
    const sorted = [...publishedPrompts].sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
    if (!searchValue) return sorted;
    return sorted.filter((p) =>
      (p.handle ?? p.id).toLowerCase().includes(searchValue.toLowerCase()),
    );
  }, [prompts, searchValue]);

  // Filter HTTP agents (already sorted by updatedAt desc from backend)
  const filteredAgents = useMemo(() => {
    const httpAgents = agents?.filter((a) => a.type === "http") ?? [];
    if (!searchValue) return httpAgents;
    return httpAgents.filter((a) =>
      a.name.toLowerCase().includes(searchValue.toLowerCase()),
    );
  }, [agents, searchValue]);

  const handleSelectAndRun = (target: TargetValue) => {
    onTargetChange(target);
    setOpen(false);
    setSearchValue("");
    onSaveAndRun(target);
  };

  const handleSaveWithoutRunning = () => {
    setOpen(false);
    setSearchValue("");
    onSaveWithoutRunning();
  };

  const handleCreateAgent = () => {
    setOpen(false);
    setSearchValue("");
    onCreateAgent();
  };

  const handleCreatePrompt = () => {
    setOpen(false);
    setSearchValue("");
    onCreatePrompt?.();
  };

  return (
    <Popover.Root
      open={open}
      onOpenChange={(e) => {
        setOpen(e.open);
        if (e.open) {
          setTimeout(() => inputRef.current?.focus(), 0);
        }
      }}
      positioning={{ placement: "top-end" }}
    >
      <Popover.Trigger asChild>
        <Button colorPalette="blue" size="sm" loading={isLoading}>
          <Play size={14} />
          Save and Run
          <ChevronDown size={14} />
        </Button>
      </Popover.Trigger>

      <Portal>
        <Popover.Content width="320px" padding={0}>
          {/* Search Input - Sticky at top */}
          <Box
            padding={2}
            borderBottomWidth="1px"
            borderColor="gray.200"
            position="sticky"
            top={0}
            bg="white"
            zIndex={10}
          >
            <Input
              ref={inputRef}
              size="sm"
              placeholder="Search prompts or agents..."
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
            />
          </Box>

          {/* Scrollable Content */}
          <Box maxHeight="400px" overflowY="auto">
            {/* Agents Section - First (typically fewer items) */}
            <Box>
              <Text
                fontSize="xs"
                fontWeight="bold"
                textTransform="uppercase"
                color="gray.500"
                paddingX={3}
                paddingY={2}
                bg="gray.50"
                position="sticky"
                top={0}
                zIndex={5}
              >
                Run against HTTP Agent
              </Text>
              {filteredAgents.length === 0 ? (
                <Text
                  fontSize="sm"
                  color="gray.400"
                  paddingX={3}
                  paddingY={2}
                >
                  {searchValue ? "No agents found" : "No agents available"}
                </Text>
              ) : (
                filteredAgents.map((agent) => (
                  <HStack
                    key={agent.id}
                    paddingX={3}
                    paddingY={2}
                    cursor="pointer"
                    bg={
                      selectedTarget?.type === "http" &&
                      selectedTarget.id === agent.id
                        ? "blue.50"
                        : "transparent"
                    }
                    _hover={{ bg: "gray.100" }}
                    onClick={() =>
                      handleSelectAndRun({ type: "http", id: agent.id })
                    }
                  >
                    <Globe size={14} color="var(--chakra-colors-gray-500)" />
                    <Text fontSize="sm" flex={1}>
                      {agent.name}
                    </Text>
                    <Play size={12} color="var(--chakra-colors-blue-500)" />
                  </HStack>
                ))
              )}
              {/* Add New Agent Button */}
              <HStack
                paddingX={3}
                paddingY={2}
                cursor="pointer"
                _hover={{ bg: "gray.100" }}
                borderTopWidth="1px"
                borderColor="gray.100"
                color="blue.500"
                onClick={handleCreateAgent}
              >
                <Plus size={14} />
                <Text fontSize="sm">Add New Agent</Text>
              </HStack>
            </Box>

            {/* Prompts Section */}
            <Box borderTopWidth="1px" borderColor="gray.200">
              <Text
                fontSize="xs"
                fontWeight="bold"
                textTransform="uppercase"
                color="gray.500"
                paddingX={3}
                paddingY={2}
                bg="gray.50"
                position="sticky"
                top={0}
                zIndex={5}
              >
                Run against Prompt
              </Text>
              {filteredPrompts.length === 0 ? (
                <Text
                  fontSize="sm"
                  color="gray.400"
                  paddingX={3}
                  paddingY={2}
                >
                  {searchValue ? "No prompts found" : "No prompts available"}
                </Text>
              ) : (
                filteredPrompts.map((prompt) => (
                  <HStack
                    key={prompt.id}
                    paddingX={3}
                    paddingY={2}
                    cursor="pointer"
                    bg={
                      selectedTarget?.type === "prompt" &&
                      selectedTarget.id === prompt.id
                        ? "blue.50"
                        : "transparent"
                    }
                    _hover={{ bg: "gray.100" }}
                    onClick={() =>
                      handleSelectAndRun({ type: "prompt", id: prompt.id })
                    }
                  >
                    <BookText
                      size={14}
                      color="var(--chakra-colors-gray-500)"
                    />
                    <Text fontSize="sm" flex={1}>
                      {prompt.handle ?? prompt.id}
                    </Text>
                    <Play size={12} color="var(--chakra-colors-blue-500)" />
                  </HStack>
                ))
              )}
              {/* Add New Prompt */}
              <HStack
                paddingX={3}
                paddingY={2}
                cursor="pointer"
                _hover={{ bg: "gray.100" }}
                borderTopWidth="1px"
                borderColor="gray.100"
                color="blue.500"
                onClick={handleCreatePrompt}
              >
                <Plus size={14} />
                <Text fontSize="sm">Add New Prompt</Text>
              </HStack>
            </Box>
          </Box>

          {/* Save without running option */}
          <Box borderTopWidth="1px" borderColor="gray.200">
            <HStack
              paddingX={3}
              paddingY={3}
              cursor="pointer"
              _hover={{ bg: "gray.50" }}
              onClick={handleSaveWithoutRunning}
            >
              <Save size={14} color="var(--chakra-colors-gray-500)" />
              <Text fontSize="sm">Save without running</Text>
            </HStack>
          </Box>
        </Popover.Content>
      </Portal>
    </Popover.Root>
  );
}
