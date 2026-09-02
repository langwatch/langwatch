import { Badge, Box, Button, HStack, Input, Text } from "@chakra-ui/react";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { BookText, ChevronDown, Code, Globe, Plus, Workflow } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

export type ScenarioTarget = {
  type: "prompt" | "http" | "code" | "workflow";
  id: string;
} | null;

export type ScenarioTargetSelection = {
  type: "prompt" | "http" | "code" | "workflow";
  id: string;
};

export type ScenarioTargetPrompt = {
  id: string;
  handle: string | null;
  version: number;
  updatedAt: Date | string;
};

export type ScenarioTargetAgent = {
  id: string;
  name: string;
  type: string;
  updatedAt: Date | string;
  hasDevTunnel: boolean;
};

type ScenarioTargetAgentOption = {
  id: string;
  name: string;
  type: "http" | "code" | "workflow";
  updatedAt: Date | string;
  hasDevTunnel: boolean;
};

const supportedAgentTypes: ReadonlySet<string> = new Set(["http", "code", "workflow"]);

function LocalTunnelBadge() {
  return (
    <Tooltip content="Points at a local development tunnel started with langwatch agent dev">
      <Badge size="xs" variant="subtle" colorPalette="orange">
        Local tunnel
      </Badge>
    </Tooltip>
  );
}

export function isScenarioAgentTarget(
  target: ScenarioTarget,
): target is ScenarioTargetSelection & { type: "http" | "code" | "workflow" } {
  return target !== null && supportedAgentTypes.has(target.type);
}

export function filterScenarioTargetAgents(
  agents: ScenarioTargetAgent[] | undefined,
  searchValue: string,
): ScenarioTargetAgentOption[] {
  const filtered = (agents ?? []).filter((agent): agent is ScenarioTargetAgentOption =>
    supportedAgentTypes.has(agent.type),
  );
  const sorted = [...filtered].sort(
    (left, right) =>
      new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
  );

  if (searchValue === "") {
    return sorted;
  }
  const normalizedSearch = searchValue.toLowerCase();
  return sorted.filter((agent) => agent.name.toLowerCase().includes(normalizedSearch));
}

export function ScenarioTargetSelector({
  value,
  onChange,
  prompts,
  agents,
  onCreateAgent,
  onCreatePrompt,
  placeholder = "Select a prompt or agent...",
}: {
  value: ScenarioTarget;
  onChange(value: ScenarioTarget): void;
  prompts: ScenarioTargetPrompt[] | undefined;
  agents: ScenarioTargetAgent[] | undefined;
  onCreateAgent?(): void;
  onCreatePrompt?(): void;
  placeholder?: string;
}) {
  const [searchValue, setSearchValue] = useState("");
  const [open, setOpen] = useState(false);
  const [maxDropdownHeight, setMaxDropdownHeight] = useState(400);
  const [dropUp, setDropUp] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const closeOnOutsideClick = (event: MouseEvent) => {
      const eventTarget = event.target;
      const isInside =
        eventTarget instanceof Node && containerRef.current?.contains(eventTarget);
      if (!isInside) {
        setOpen(false);
        setSearchValue("");
      }
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, [open]);

  const filteredPrompts = useMemo(() => {
    const publishedPrompts = prompts?.filter((prompt) => prompt.version > 0) ?? [];
    const sorted = [...publishedPrompts].sort(
      (left, right) =>
        new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
    );
    if (searchValue === "") {
      return sorted;
    }
    const normalizedSearch = searchValue.toLowerCase();
    return sorted.filter((prompt) =>
      (prompt.handle ?? prompt.id).toLowerCase().includes(normalizedSearch),
    );
  }, [prompts, searchValue]);

  const filteredAgents = useMemo(
    () => filterScenarioTargetAgents(agents, searchValue),
    [agents, searchValue],
  );

  const selectedLabel = useMemo(() => {
    if (value === null) {
      return null;
    }
    if (value.type === "prompt") {
      const prompt = prompts?.find((candidate) => candidate.id === value.id);
      return prompt?.handle ?? prompt?.id ?? null;
    }
    return agents?.find((agent) => agent.id === value.id)?.name ?? null;
  }, [agents, prompts, value]);

  const resetDropdown = () => {
    setOpen(false);
    setSearchValue("");
  };

  const handleSelect = (target: ScenarioTargetSelection) => {
    onChange(target);
    resetDropdown();
    triggerRef.current?.focus();
  };

  const handleToggle = () => {
    const nextOpen = !open;
    setOpen(nextOpen);
    if (!nextOpen) {
      setSearchValue("");
      return;
    }

    const triggerBounds = triggerRef.current?.getBoundingClientRect();
    if (triggerBounds) {
      const spaceBelow = window.innerHeight - triggerBounds.bottom - 8;
      const spaceAbove = triggerBounds.top - 8;
      const shouldDropUp = spaceAbove > spaceBelow;
      const availableSpace = shouldDropUp ? spaceAbove : spaceBelow;
      setDropUp(shouldDropUp);
      setMaxDropdownHeight(Math.min(400, Math.max(40, availableSpace)));
    }

    setTimeout(() => {
      inputRef.current?.focus();
      scrollContainerRef.current?.scrollTo(0, 0);
    }, 0);
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
          {value?.type === "workflow" && <Workflow size={14} />}
          <Text>{selectedLabel ?? placeholder}</Text>
        </HStack>
        <ChevronDown size={14} />
      </Button>
      {open && (
        <Box
          position="absolute"
          {...(dropUp
            ? { bottom: "100%", marginBottom: 1 }
            : { top: "100%", marginTop: 1 })}
          left={0}
          width="300px"
          maxHeight={`${maxDropdownHeight}px`}
          borderRadius="lg"
          borderWidth="1px"
          borderColor="border"
          background="bg.panel"
          boxShadow="lg"
          zIndex={10}
          overflow="hidden"
          display="flex"
          flexDirection="column"
          onPointerDown={(event) => event.stopPropagation()}
          data-testid="target-selector-dropdown"
        >
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
              onChange={(event) => setSearchValue(event.target.value)}
            />
          </Box>
          <Box ref={scrollContainerRef} flex={1} minHeight={0} overflowY="auto">
            <ScenarioTargetAgentOptions
              agents={filteredAgents}
              searchValue={searchValue}
              selectedTarget={value}
              onSelect={handleSelect}
              onCreate={() => {
                resetDropdown();
                onCreateAgent?.();
              }}
            />
            <ScenarioTargetPromptOptions
              prompts={filteredPrompts}
              searchValue={searchValue}
              selectedTarget={value}
              onSelect={handleSelect}
              onCreate={() => {
                resetDropdown();
                onCreatePrompt?.();
              }}
            />
          </Box>
        </Box>
      )}
    </Box>
  );
}

function ScenarioTargetAgentOptions({
  agents,
  searchValue,
  selectedTarget,
  onSelect,
  onCreate,
}: {
  agents: ScenarioTargetAgentOption[];
  searchValue: string;
  selectedTarget: ScenarioTarget;
  onSelect(target: ScenarioTargetSelection): void;
  onCreate(): void;
}) {
  return (
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
      {agents.length === 0 ? (
        <Text fontSize="sm" color="fg.subtle" paddingX={3} paddingY={2}>
          {searchValue === "" ? "No agents available" : "No agents found"}
        </Text>
      ) : (
        agents.map((agent) => (
          <HStack
            key={agent.id}
            data-testid={`target-option-${agent.id}`}
            paddingX={3}
            paddingY={2}
            cursor="pointer"
            bg={
              isScenarioAgentTarget(selectedTarget) && selectedTarget.id === agent.id
                ? "blue.50"
                : "transparent"
            }
            _hover={{ bg: "bg.subtle" }}
            onClick={() => onSelect({ type: agent.type, id: agent.id })}
          >
            {agent.type === "code" ? (
              <Code size={14} color="var(--chakra-colors-gray-500)" />
            ) : (
              <Globe size={14} color="var(--chakra-colors-gray-500)" />
            )}
            <Text fontSize="sm" flex={1}>
              {agent.name}
            </Text>
            {agent.hasDevTunnel && <LocalTunnelBadge />}
            {isScenarioAgentTarget(selectedTarget) && selectedTarget.id === agent.id && (
              <Text color="blue.500" fontSize="sm">
                ✓
              </Text>
            )}
          </HStack>
        ))
      )}
      <HStack
        paddingX={3}
        paddingY={2}
        cursor="pointer"
        _hover={{ bg: "bg.subtle" }}
        borderTopWidth="1px"
        borderColor="border.muted"
        color="blue.500"
        onClick={onCreate}
      >
        <Plus size={14} />
        <Text fontSize="sm">Add New Agent</Text>
      </HStack>
    </Box>
  );
}

function ScenarioTargetPromptOptions({
  prompts,
  searchValue,
  selectedTarget,
  onSelect,
  onCreate,
}: {
  prompts: ScenarioTargetPrompt[];
  searchValue: string;
  selectedTarget: ScenarioTarget;
  onSelect(target: ScenarioTargetSelection): void;
  onCreate(): void;
}) {
  return (
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
      {prompts.length === 0 ? (
        <Text fontSize="sm" color="fg.subtle" paddingX={3} paddingY={2}>
          {searchValue === "" ? "No prompts available" : "No prompts found"}
        </Text>
      ) : (
        prompts.map((prompt) => (
          <HStack
            key={prompt.id}
            paddingX={3}
            paddingY={2}
            cursor="pointer"
            bg={
              selectedTarget?.type === "prompt" && selectedTarget.id === prompt.id
                ? "blue.50"
                : "transparent"
            }
            _hover={{ bg: "bg.subtle" }}
            onClick={() => onSelect({ type: "prompt", id: prompt.id })}
          >
            <BookText size={14} color="var(--chakra-colors-gray-500)" />
            <Text fontSize="sm" flex={1}>
              {prompt.handle ?? prompt.id}
            </Text>
            {selectedTarget?.type === "prompt" && selectedTarget.id === prompt.id && (
              <Text color="blue.500" fontSize="sm">
                ✓
              </Text>
            )}
          </HStack>
        ))
      )}
      <HStack
        paddingX={3}
        paddingY={2}
        cursor="pointer"
        _hover={{ bg: "bg.subtle" }}
        borderTopWidth="1px"
        borderColor="border.muted"
        color="blue.500"
        onClick={onCreate}
      >
        <Plus size={14} />
        <Text fontSize="sm">Add New Prompt</Text>
      </HStack>
    </Box>
  );
}
