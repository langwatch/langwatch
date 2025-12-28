import { Box, HStack, IconButton, Text } from "@chakra-ui/react";
import { Code, Edit2, Trash2 } from "react-feather";
import { ChevronDown, FileText } from "lucide-react";
import { LuPlay } from "react-icons/lu";

import { Menu } from "~/components/ui/menu";
import { ColorfulBlockIcon } from "~/optimization_studio/components/ColorfulBlockIcons";
import type { RunnerConfig } from "../../types";

type RunnerHeaderProps = {
  runner: RunnerConfig;
  onEdit?: (runner: RunnerConfig) => void;
  onRemove?: (runnerId: string) => void;
  onRun?: (runner: RunnerConfig) => void;
};

/**
 * Header component for runner columns in the evaluations table.
 * Shows runner name with icon, a play button, and a dropdown menu on click.
 *
 * Menu options:
 * - For prompts: "Edit Prompt", "Remove from Workbench"
 * - For agents: "Edit Agent", "Remove from Workbench"
 *
 * Note: For workflow agents, clicking "Edit Agent" opens the workflow in a new tab.
 * This is determined at runtime by fetching the agent data via tRPC.
 */
export function RunnerHeader({ runner, onEdit, onRemove, onRun }: RunnerHeaderProps) {
  // Determine icon based on runner type
  const getRunnerIcon = () => {
    if (runner.type === "prompt") {
      return <FileText size={12} />;
    }
    return <Code size={12} />;
  };

  const getRunnerColor = () => {
    return runner.type === "prompt" ? "green.400" : "#3E5A60";
  };

  const editLabel = runner.type === "prompt" ? "Edit Prompt" : "Edit Agent";

  return (
    <HStack gap={2} width="full" justify="space-between">
      <Menu.Root positioning={{ placement: "bottom-start" }}>
        <Menu.Trigger asChild>
          <HStack
            gap={2}
            cursor="pointer"
            _hover={{ bg: "gray.50" }}
            data-testid="runner-header-button"
            flex={1}
            minWidth={0}
            paddingX={1}
            paddingY={0.5}
            marginX={-1}
            borderRadius="md"
          >
            <ColorfulBlockIcon
              color={getRunnerColor()}
              size="xs"
              icon={getRunnerIcon()}
            />
            <Text fontSize="13px" fontWeight="medium" truncate>
              {runner.name}
            </Text>
            {/* <ChevronDown size={12} /> */}
          </HStack>
        </Menu.Trigger>
        <Menu.Content minWidth="200px">
          <Menu.Item value="edit" onClick={() => onEdit?.(runner)}>
            <HStack gap={2}>
              <Edit2 size={14} />
              <Text>{editLabel}</Text>
            </HStack>
          </Menu.Item>
          <Box borderTopWidth="1px" borderColor="gray.200" my={1} />
          <Menu.Item value="remove" onClick={() => onRemove?.(runner.id)}>
            <HStack gap={2} color="red.600">
              <Trash2 size={14} />
              <Text>Remove from Workbench</Text>
            </HStack>
          </Menu.Item>
        </Menu.Content>
      </Menu.Root>

      {/* Play button on far right */}
      <IconButton
        aria-label="Run evaluation for this runner"
        size="xs"
        variant="ghost"
        onClick={(e) => {
          e.stopPropagation();
          onRun?.(runner);
        }}
        data-testid="runner-play-button"
        minWidth="auto"
        height="auto"
        padding={1}
      >
        <LuPlay size={14} />
      </IconButton>
    </HStack>
  );
}
