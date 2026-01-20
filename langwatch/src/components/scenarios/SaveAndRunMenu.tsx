import { Box, Button, HStack, Portal, Text, VStack } from "@chakra-ui/react";
import {
  BookText,
  ChevronDown,
  Globe,
  Play,
  RotateCcw,
  Save,
} from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { setFlowCallbacks, useDrawer } from "../../hooks/useDrawer";
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
 * Button-style menu items that open drawer pickers for prompts and agents.
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
  const { openDrawer, closeDrawer } = useDrawer();

  const [open, setOpen] = useState(false);

  // Get the name of the previous target for display
  const previousTargetInfo = useMemo(() => {
    if (!selectedTarget) return null;

    if (selectedTarget.type === "prompt") {
      const prompt = prompts?.find((p) => p.id === selectedTarget.id);
      return {
        name: prompt?.handle ?? prompt?.id ?? "Unknown prompt",
        type: "prompt" as const,
      };
    } else {
      const agent = agents?.find((a) => a.id === selectedTarget.id);
      return {
        name: agent?.name ?? "Unknown agent",
        type: "agent" as const,
      };
    }
  }, [selectedTarget, prompts, agents]);

  const handleRunPrevious = () => {
    if (selectedTarget) {
      setOpen(false);
      onSaveAndRun(selectedTarget);
    }
  };

  const handleOpenPromptDrawer = () => {
    setOpen(false);
    // Set up callback for when a prompt is selected
    setFlowCallbacks("promptList", {
      onSelect: (prompt) => {
        const target: TargetValue = { type: "prompt", id: prompt.id };
        onTargetChange(target);
        onSaveAndRun(target);
        closeDrawer();
      },
      onCreateNew: onCreatePrompt
        ? () => {
            closeDrawer();
            onCreatePrompt();
          }
        : undefined,
    });
    openDrawer("promptList");
  };

  const handleOpenAgentDrawer = () => {
    setOpen(false);
    // Set up callback for when an agent is selected
    setFlowCallbacks("agentList", {
      onSelect: (agent) => {
        const target: TargetValue = { type: "http", id: agent.id };
        onTargetChange(target);
        onSaveAndRun(target);
        closeDrawer();
      },
      onCreateNew: () => {
        closeDrawer();
        onCreateAgent();
      },
    });
    openDrawer("agentList");
  };

  const handleSaveWithoutRunning = () => {
    setOpen(false);
    onSaveWithoutRunning();
  };

  return (
    <Popover.Root
      open={open}
      onOpenChange={(e) => setOpen(e.open)}
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
        <Popover.Content width="320px" padding={3}>
          <VStack gap={2} align="stretch">
            {/* Run Previous - only shown if there's a previous target */}
            {previousTargetInfo && (
              <>
                <MenuButton
                  icon={<RotateCcw size={16} />}
                  title="Run previous"
                  description={`${previousTargetInfo.name} (${previousTargetInfo.type})`}
                  onClick={handleRunPrevious}
                />
                <Box
                  borderBottomWidth="1px"
                  borderColor="gray.200"
                  marginY={1}
                />
              </>
            )}

            {/* Run against prompt */}
            <MenuButton
              icon={<BookText size={16} />}
              title="Run against prompt"
              description="Test with a prompt config"
              onClick={handleOpenPromptDrawer}
            />

            {/* Run against agent */}
            <MenuButton
              icon={<Globe size={16} />}
              title="Run against agent"
              description="Test with an HTTP endpoint"
              onClick={handleOpenAgentDrawer}
            />

            {/* Save only */}
            <Box borderBottomWidth="1px" borderColor="gray.200" marginY={1} />
            <HStack
              as="button"
              paddingX={2}
              paddingY={2}
              cursor="pointer"
              borderRadius="md"
              width="100%"
              _hover={{ bg: "gray.50" }}
              onClick={handleSaveWithoutRunning}
            >
              <Save size={14} color="var(--chakra-colors-gray-500)" />
              <Text fontSize="sm" color="gray.600">
                Save only
              </Text>
            </HStack>
          </VStack>
        </Popover.Content>
      </Portal>
    </Popover.Root>
  );
}

interface MenuButtonProps {
  icon: ReactNode;
  title: string;
  description: string;
  onClick: () => void;
}

function MenuButton({ icon, title, description, onClick }: MenuButtonProps) {
  return (
    <HStack
      as="button"
      padding={3}
      cursor="pointer"
      borderRadius="md"
      borderWidth="1px"
      borderColor="gray.200"
      bg="white"
      width="100%"
      _hover={{ bg: "gray.50", borderColor: "gray.300" }}
      onClick={onClick}
      gap={3}
    >
      <Box color="gray.500">{icon}</Box>
      <VStack align="start" gap={0} flex={1}>
        <Text fontSize="sm" fontWeight="medium">
          {title}
        </Text>
        <Text fontSize="xs" color="gray.500">
          {description}
        </Text>
      </VStack>
    </HStack>
  );
}
