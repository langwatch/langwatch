import { Box, Button, HStack, Portal, Text, VStack } from "@chakra-ui/react";
import {
  BookText,
  ChevronDown,
  Globe,
  Play,
  RotateCcw,
  Save,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { useAllPromptsForProject } from "../../prompts/hooks/useAllPromptsForProject";
import { api } from "../../utils/api";
import { Popover } from "../ui/popover";
import { AgentPickerModal } from "./AgentPickerModal";
import { PromptPickerModal } from "./PromptPickerModal";
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
 * Button-style menu items that open picker modals for prompts and agents.
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

  const [open, setOpen] = useState(false);
  const [promptModalOpen, setPromptModalOpen] = useState(false);
  const [agentModalOpen, setAgentModalOpen] = useState(false);

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

  const handleOpenPromptModal = () => {
    setOpen(false);
    setPromptModalOpen(true);
  };

  const handleOpenAgentModal = () => {
    setOpen(false);
    setAgentModalOpen(true);
  };

  const handleSelectPrompt = (promptId: string) => {
    const target: TargetValue = { type: "prompt", id: promptId };
    onTargetChange(target);
    onSaveAndRun(target);
  };

  const handleSelectAgent = (agentId: string) => {
    const target: TargetValue = { type: "http", id: agentId };
    onTargetChange(target);
    onSaveAndRun(target);
  };

  const handleSaveWithoutRunning = () => {
    setOpen(false);
    onSaveWithoutRunning();
  };

  const handleCreateAgent = () => {
    setAgentModalOpen(false);
    onCreateAgent();
  };

  const handleCreatePrompt = () => {
    setPromptModalOpen(false);
    onCreatePrompt?.();
  };

  return (
    <>
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
                onClick={handleOpenPromptModal}
              />

              {/* Run against agent */}
              <MenuButton
                icon={<Globe size={16} />}
                title="Run against agent"
                description="Test with an HTTP endpoint"
                onClick={handleOpenAgentModal}
              />

              {/* Save only */}
              <Box borderBottomWidth="1px" borderColor="gray.200" marginY={1} />
              <HStack
                paddingX={2}
                paddingY={2}
                cursor="pointer"
                borderRadius="md"
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

      {/* Prompt Picker Modal */}
      <PromptPickerModal
        open={promptModalOpen}
        onClose={() => setPromptModalOpen(false)}
        onSelect={handleSelectPrompt}
        onCreateNew={handleCreatePrompt}
      />

      {/* Agent Picker Modal */}
      <AgentPickerModal
        open={agentModalOpen}
        onClose={() => setAgentModalOpen(false)}
        onSelect={handleSelectAgent}
        onCreateNew={handleCreateAgent}
      />
    </>
  );
}

interface MenuButtonProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
}

function MenuButton({ icon, title, description, onClick }: MenuButtonProps) {
  return (
    <HStack
      padding={3}
      cursor="pointer"
      borderRadius="md"
      borderWidth="1px"
      borderColor="gray.200"
      bg="white"
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
