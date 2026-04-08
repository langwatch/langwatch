import { Box, Button, HStack, Input, Text } from "@chakra-ui/react";
import { BookText, ChevronDown, Code, Globe, Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { useAllPromptsForProject } from "../../prompts/hooks/useAllPromptsForProject";
import { api } from "../../utils/api";
import {
  isAgentTarget,
  useFilteredAgents,
} from "./useFilteredScenarioTargets";

export type TargetValue = {
  type: "prompt" | "http" | "code";
  id: string;
} | null;

interface TargetSelectorProps {
  value: TargetValue;
  onChange: (value: TargetValue) => void;
  onCreateAgent?: () => void;
  onCreatePrompt?: () => void;
  placeholder?: string;
}

/**
 * Unified target selector for scenarios.
 * Uses a simple positioned dropdown instead of Popover to work
 * reliably inside Dialogs and Drawers without portal/z-index issues.
 */
export function TargetSelector({
  value,
  onChange,
  onCreateAgent,
  onCreatePrompt,
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
  const [maxDropdownHeight, setMaxDropdownHeight] = useState(400);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearchValue("");
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  // Filter and sort prompts (only published ones with version > 0, sorted by updatedAt desc)
  const filteredPrompts = useMemo(() => {
    const publishedPrompts = prompts?.filter((p) => p.version > 0) ?? [];
    const sorted = [...publishedPrompts].sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
    if (!searchValue) return sorted;
    return sorted.filter((p) =>
      (p.handle ?? p.id).toLowerCase().includes(searchValue.toLowerCase()),
    );
  }, [prompts, searchValue]);

  const filteredAgents = useFilteredAgents(agents, searchValue);

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

  const handleSelect = (target: NonNullable<TargetValue>) => {
    onChange(target);
    setOpen(false);
    setSearchValue("");
    triggerRef.current?.focus();
  };

  const handleCreateAgent = () => {
    setOpen(false);
    setSearchValue("");
    onCreateAgent?.();
  };

  const handleCreatePrompt = () => {
    setOpen(false);
    setSearchValue("");
    onCreatePrompt?.();
  };

  const handleToggle = () => {
    const next = !open;
    setOpen(next);
    if (next) {
      // Cap dropdown height to available space below the trigger
      const triggerRect = triggerRef.current?.getBoundingClientRect();
      if (triggerRect) {
        const spaceBelow = window.innerHeight - triggerRect.bottom - 8; // 8px padding from viewport edge
        setMaxDropdownHeight(Math.min(400, Math.max(40, spaceBelow)));
      }
      setTimeout(() => {
        inputRef.current?.focus();
        scrollContainerRef.current?.scrollTo(0, 0);
      }, 0);
    } else {
      setSearchValue("");
    }
  };

  return (
    <Box ref={containerRef} position="relative" width="fit-content">
      <Button
        ref={triggerRef}
        variant="outline"
        size="sm"
        minWidth="240px"
        justifyContent="space-between"
        onClick={handleToggle}
        data-testid="target-selector-trigger"
      >
        <HStack gap={2}>
          {value?.type === "prompt" && <BookText size={14} />}
          {value?.type === "http" && <Globe size={14} />}
          {value?.type === "code" && <Code size={14} />}
          <Text>{selectedLabel ?? placeholder}</Text>
        </HStack>
        <ChevronDown size={14} />
      </Button>

      {open && (
        <Box
          position="absolute"
          top="100%"
          left={0}
          width="300px"
          maxHeight={`${maxDropdownHeight}px`}
          marginTop={1}
          borderRadius="lg"
          borderWidth="1px"
          borderColor="border"
          background="bg.panel"
          boxShadow="lg"
          zIndex={10}
          overflow="hidden"
          display="flex"
          flexDirection="column"
          onPointerDown={(e) => e.stopPropagation()}
          data-testid="target-selector-dropdown"
        >
          {/* Search Input */}
          <Box
            padding={2}
            borderBottomWidth="1px"
            borderColor="border"
            bg="bg"
            flexShrink={0}
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
          <Box ref={scrollContainerRef} flex={1} minHeight={0} overflowY="auto">
            {/* Agents Section */}
            <Box>
              <Text
                fontSize="xs"
                fontWeight="bold"
                textTransform="uppercase"
                color="fg.muted"
                paddingX={3}
                paddingY={2}
                bg="bg.subtle"
                position="sticky"
                top={0}
                zIndex={5}
              >
                Agents
              </Text>
              {filteredAgents.length === 0 ? (
                <Text fontSize="sm" color="fg.subtle" paddingX={3} paddingY={2}>
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
                      isAgentTarget(value) && value.id === agent.id
                        ? "blue.50"
                        : "transparent"
                    }
                    _hover={{ bg: "bg.subtle" }}
                    onClick={() =>
                      handleSelect({
                        type: agent.type,
                        id: agent.id,
                      })
                    }
                  >
                    {agent.type === "code" ? (
                      <Code size={14} color="var(--chakra-colors-gray-500)" />
                    ) : (
                      <Globe size={14} color="var(--chakra-colors-gray-500)" />
                    )}
                    <Text fontSize="sm" flex={1}>
                      {agent.name}
                    </Text>
                    {isAgentTarget(value) && value.id === agent.id && (
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
                _hover={{ bg: "bg.subtle" }}
                borderTopWidth="1px"
                borderColor="border.muted"
                color="blue.500"
                onClick={handleCreateAgent}
              >
                <Plus size={14} />
                <Text fontSize="sm">Add New Agent</Text>
              </HStack>
            </Box>

            {/* Prompts Section */}
            <Box borderTopWidth="1px" borderColor="border">
              <Text
                fontSize="xs"
                fontWeight="bold"
                textTransform="uppercase"
                color="fg.muted"
                paddingX={3}
                paddingY={2}
                bg="bg.subtle"
                position="sticky"
                top={0}
                zIndex={5}
              >
                Prompts
              </Text>
              {filteredPrompts.length === 0 ? (
                <Text fontSize="sm" color="fg.subtle" paddingX={3} paddingY={2}>
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
                    _hover={{ bg: "bg.subtle" }}
                    onClick={() =>
                      handleSelect({ type: "prompt", id: prompt.id })
                    }
                  >
                    <BookText size={14} color="var(--chakra-colors-gray-500)" />
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
              {/* Add New Prompt */}
              <HStack
                paddingX={3}
                paddingY={2}
                cursor="pointer"
                _hover={{ bg: "bg.subtle" }}
                borderTopWidth="1px"
                borderColor="border.muted"
                color="blue.500"
                onClick={handleCreatePrompt}
              >
                <Plus size={14} />
                <Text fontSize="sm">Add New Prompt</Text>
              </HStack>
            </Box>
          </Box>
        </Box>
      )}
    </Box>
  );
}
