import { Box, Button, HStack, Portal, Text, VStack } from "@chakra-ui/react";
import { BookText, ChevronDown, Globe, Play, Save } from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { setFlowCallbacks, useDrawer } from "../../hooks/useDrawer";
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
  /** Called when user wants to create a new agent. Receives callback to invoke when creation completes. */
  onCreateAgent: (onComplete: () => void) => void;
  /** Called when user wants to create a new prompt. Receives callback to invoke when creation completes. */
  onCreatePrompt?: (onComplete: () => void) => void;
  isLoading?: boolean;
}

/**
 * Combined "Save and Run" dropdown menu with target selection.
 *
 * Flow:
 * 1. If a target is selected, shows "Run [target]" as primary action
 * 2. User can pick a different target via drawer (just selects, doesn't run)
 * 3. After selection, menu reopens with new target ready to run
 * 4. User explicitly clicks "Run [target]" to save and execute
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
  const { openDrawer, goBack } = useDrawer();

  const [open, setOpen] = useState(false);
  // Use a ref to track pending reopen - refs survive across drawer navigation
  const pendingReopenRef = useRef(false);

  // Function to reopen the menu - can be called after drawer navigation
  const reopenMenu = useCallback(() => {
    // Small delay to let drawer close animation complete
    setTimeout(() => setOpen(true), 150);
  }, []);

  // Get display info for the selected target
  const targetInfo = useMemo(() => {
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

  const handleRunTarget = () => {
    if (selectedTarget) {
      setOpen(false);
      onSaveAndRun(selectedTarget);
    }
  };

  const handleOpenPromptDrawer = () => {
    setOpen(false);
    pendingReopenRef.current = true;
    // Set up callback for when a prompt is selected - just updates target, doesn't run
    setFlowCallbacks("promptList", {
      onSelect: (prompt) => {
        const target: TargetValue = { type: "prompt", id: prompt.id };
        onTargetChange(target);
        goBack();
        // Reopen menu after selection
        if (pendingReopenRef.current) {
          pendingReopenRef.current = false;
          reopenMenu();
        }
      },
      onCreateNew: onCreatePrompt
        ? () => {
            goBack();
            onCreatePrompt(() => {
              // After creation, reopen menu
              reopenMenu();
            });
          }
        : undefined,
    });
    openDrawer("promptList");
  };

  const handleOpenAgentDrawer = () => {
    setOpen(false);
    pendingReopenRef.current = true;
    // Set up callback for when an agent is selected - just updates target, doesn't run
    setFlowCallbacks("agentList", {
      onSelect: (agent) => {
        const target: TargetValue = { type: "http", id: agent.id };
        onTargetChange(target);
        goBack();
        // Reopen menu after selection
        if (pendingReopenRef.current) {
          pendingReopenRef.current = false;
          reopenMenu();
        }
      },
      onCreateNew: () => {
        goBack();
        onCreateAgent(() => {
          // After creation, reopen menu
          reopenMenu();
        });
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
            {/* Primary action: Run selected target */}
            {targetInfo && (
              <>
                <MenuButton
                  icon={<Play size={16} />}
                  title={`Run "${targetInfo.name}"`}
                  description={
                    targetInfo.type === "prompt" ? "Prompt" : "Agent"
                  }
                  onClick={handleRunTarget}
                  highlighted
                />
                <SectionDivider label="Or select a different target" />
              </>
            )}

            {/* No target selected - show header */}
            {!targetInfo && (
              <Text
                fontSize="xs"
                color="gray.500"
                fontWeight="medium"
                paddingX={1}
                paddingBottom={1}
              >
                Select a target to run against
              </Text>
            )}

            {/* Target selection options */}
            <MenuButton
              icon={<BookText size={16} />}
              title="Choose a prompt..."
              description="Select from your prompts"
              onClick={handleOpenPromptDrawer}
            />

            <MenuButton
              icon={<Globe size={16} />}
              title="Choose an agent..."
              description="Select from your agents"
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
  highlighted?: boolean;
}

function MenuButton({
  icon,
  title,
  description,
  onClick,
  highlighted,
}: MenuButtonProps) {
  return (
    <HStack
      as="button"
      padding={3}
      cursor="pointer"
      borderRadius="md"
      borderWidth="1px"
      borderColor={highlighted ? "blue.200" : "gray.200"}
      bg={highlighted ? "blue.50" : "white"}
      width="100%"
      _hover={{
        bg: highlighted ? "blue.100" : "gray.50",
        borderColor: highlighted ? "blue.300" : "gray.300",
      }}
      onClick={onClick}
      gap={3}
    >
      <Box color={highlighted ? "blue.500" : "gray.500"}>{icon}</Box>
      <VStack align="start" gap={0} flex={1}>
        <Text
          fontSize="sm"
          fontWeight="medium"
          color={highlighted ? "blue.700" : undefined}
        >
          {title}
        </Text>
        <Text fontSize="xs" color={highlighted ? "blue.500" : "gray.500"}>
          {description}
        </Text>
      </VStack>
    </HStack>
  );
}

function SectionDivider({ label }: { label: string }) {
  return (
    <HStack gap={2} paddingY={1}>
      <Box flex={1} borderBottomWidth="1px" borderColor="gray.200" />
      <Text fontSize="xs" color="gray.400" whiteSpace="nowrap">
        {label}
      </Text>
      <Box flex={1} borderBottomWidth="1px" borderColor="gray.200" />
    </HStack>
  );
}
