import { Box, Button, HStack, Input, Portal, Text } from "@chakra-ui/react";
import { BookText, ChevronDown, Globe, Plus } from "lucide-react";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { useAllPromptsForProject } from "../../prompts/hooks/useAllPromptsForProject";
import { api } from "../../utils/api";
import { Popover } from "../ui/popover";

export type TargetValue = {
  type: "prompt" | "http";
  id: string;
} | null;

interface TargetSelectorProps {
  value: TargetValue;
  onChange: (value: TargetValue) => void;
  onCreateAgent?: () => void;
  placeholder?: string;
}

type SelectableItem = {
  type: "prompt" | "http";
  id: string;
  label: string;
};

/**
 * Unified target selector for scenarios.
 * Shows prompts and HTTP agents in grouped sections with search.
 * Includes actions to create new prompts/agents.
 */
export function TargetSelector({
  value,
  onChange,
  onCreateAgent,
  placeholder = "Select a prompt or agent...",
}: TargetSelectorProps) {
  const { project } = useOrganizationTeamProject();
  const { data: prompts } = useAllPromptsForProject();
  const { data: agents } = api.agents.getAll.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project?.id },
  );

  const [searchValue, setSearchValue] = useState("");
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Filter and sort prompts (only published ones with version > 0, sorted by updatedAt desc)
  const filteredPrompts = useMemo(() => {
    const publishedPrompts = prompts?.filter((p) => p.version > 0) ?? [];
    const sorted = [...publishedPrompts].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
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

  // Get the selected item's label for display
  const selectedLabel = useMemo(() => {
    if (!value) return null;
    if (value.type === "prompt") {
      const prompt = prompts?.find((p) => p.id === value.id);
      return prompt ? (prompt.handle ?? prompt.id) : null;
    }
    const agent = agents?.find((a) => a.id === value.id);
    return agent?.name ?? null;
  }, [value, prompts, agents]);

  const handleSelect = (item: SelectableItem) => {
    onChange({ type: item.type, id: item.id });
    setOpen(false);
    setSearchValue("");
    triggerRef.current?.focus();
  };

  const handleCreateAgent = () => {
    setOpen(false);
    setSearchValue("");
    onCreateAgent?.();
  };

  return (
    <Popover.Root
      open={open}
      onOpenChange={(e) => {
        setOpen(e.open);
        if (e.open) {
          // Focus search input when opening
          setTimeout(() => inputRef.current?.focus(), 0);
        }
      }}
      positioning={{ placement: "top-start" }}
    >
      <Popover.Trigger asChild>
        <Button
          ref={triggerRef}
          variant="outline"
          size="sm"
          minWidth="240px"
          justifyContent="space-between"
        >
          <HStack gap={2}>
            {value?.type === "prompt" && <BookText size={14} />}
            {value?.type === "http" && <Globe size={14} />}
            <Text>{selectedLabel ?? placeholder}</Text>
          </HStack>
          <ChevronDown size={14} />
        </Button>
      </Popover.Trigger>

      <Portal>
        <Popover.Content width="300px" padding={0}>
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
                HTTP Agents
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
                      value?.type === "http" && value.id === agent.id
                        ? "blue.50"
                        : "transparent"
                    }
                    _hover={{ bg: "gray.100" }}
                    onClick={() =>
                      handleSelect({
                        type: "http",
                        id: agent.id,
                        label: agent.name,
                      })
                    }
                  >
                    <Globe size={14} color="var(--chakra-colors-gray-500)" />
                    <Text fontSize="sm" flex={1}>
                      {agent.name}
                    </Text>
                    {value?.type === "http" && value.id === agent.id && (
                      <Text color="blue.500" fontSize="sm">
                        ✓
                      </Text>
                    )}
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
                Prompts
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
                      value?.type === "prompt" && value.id === prompt.id
                        ? "blue.50"
                        : "transparent"
                    }
                    _hover={{ bg: "gray.100" }}
                    onClick={() =>
                      handleSelect({
                        type: "prompt",
                        id: prompt.id,
                        label: prompt.handle ?? prompt.id,
                      })
                    }
                  >
                    <BookText
                      size={14}
                      color="var(--chakra-colors-gray-500)"
                    />
                    <Text fontSize="sm" flex={1}>
                      {prompt.handle ?? prompt.id}
                    </Text>
                    {value?.type === "prompt" && value.id === prompt.id && (
                      <Text color="blue.500" fontSize="sm">
                        ✓
                      </Text>
                    )}
                  </HStack>
                ))
              )}
              {/* Add New Prompt Link - opens in new tab to preserve scenario work */}
              <Link
                href={project ? `/${project.slug}/prompts` : "/"}
                target="_blank"
                rel="noopener noreferrer"
              >
                <HStack
                  paddingX={3}
                  paddingY={2}
                  cursor="pointer"
                  _hover={{ bg: "gray.100" }}
                  borderTopWidth="1px"
                  borderColor="gray.100"
                  color="blue.500"
                >
                  <Plus size={14} />
                  <Text fontSize="sm">Add New Prompt</Text>
                </HStack>
              </Link>
            </Box>
          </Box>
        </Popover.Content>
      </Portal>
    </Popover.Root>
  );
}
