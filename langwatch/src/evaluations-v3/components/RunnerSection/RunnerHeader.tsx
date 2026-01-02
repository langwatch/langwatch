import {
  Box,
  Button,
  Circle,
  HStack,
  Icon,
  IconButton,
  Spacer,
  Text,
} from "@chakra-ui/react";
import { keyframes } from "@emotion/react";
import { memo, useState } from "react";
import {
  LuChevronDown,
  LuCircleAlert,
  LuCode,
  LuFileText,
  LuPencil,
  LuPlay,
  LuTrash2,
} from "react-icons/lu";

import { Menu } from "~/components/ui/menu";
import { Tooltip } from "~/components/ui/tooltip";
import { ColorfulBlockIcon } from "~/optimization_studio/components/ColorfulBlockIcons";
import { useEvaluationsV3Store } from "../../hooks/useEvaluationsV3Store";
import type { RunnerConfig } from "../../types";
import { runnerHasMissingMappings } from "../../utils/mappingValidation";

// Pulsing animation for missing mapping alert
const pulseAnimation = keyframes`
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.2); }
`;

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
 *
 * Memoized to prevent unnecessary re-renders when other runners' config changes.
 */
export const RunnerHeader = memo(function RunnerHeader({
  runner,
  onEdit,
  onRemove,
  onRun,
}: RunnerHeaderProps) {
  // First check if prop has localPromptConfig (for direct prop usage)
  const propHasUnpublished =
    runner.type === "prompt" && !!runner.localPromptConfig;

  // Subscribe directly to just this runner's unpublished state from store
  // This is used when the table passes runners without localPromptConfig in props
  // (e.g., when using useShallow which doesn't deep-compare)
  const storeHasUnpublished = useEvaluationsV3Store((state) => {
    if (runner.type !== "prompt") return false;
    const currentRunner = state.runners.find((r) => r.id === runner.id);
    return (
      currentRunner?.type === "prompt" && !!currentRunner.localPromptConfig
    );
  });

  // Use prop value if available, otherwise use store value
  const hasUnpublishedChanges = propHasUnpublished || storeHasUnpublished;

  // Check if there are missing mappings for the active dataset
  const activeDatasetId = useEvaluationsV3Store((state) => state.activeDatasetId);
  const hasMissingMappings = runnerHasMissingMappings(runner, activeDatasetId);

  // Controlled menu state to prevent closing on re-renders
  const [menuOpen, setMenuOpen] = useState(false);

  // Determine icon based on runner type
  const getRunnerIcon = () => {
    if (runner.type === "prompt") {
      return <LuFileText size={12} />;
    }
    return <LuCode size={12} />;
  };

  const getRunnerColor = () => {
    return runner.type === "prompt" ? "green.400" : "#3E5A60";
  };

  const editLabel = runner.type === "prompt" ? "Edit Prompt" : "Edit Agent";

  return (
    <HStack gap={2} width="full" marginY={-2}>
      <Menu.Root
        positioning={{ placement: "bottom-start" }}
        open={menuOpen}
        onOpenChange={(e) => setMenuOpen(e.open)}
      >
        <Menu.Trigger asChild>
          <Button
            variant="ghost"
            size="xs"
            _hover={{ bg: "gray.100" }}
            paddingX={2}
            paddingY={1}
            gap={2}
            marginX={-2}
            marginY={-2}
            className="group"
            data-testid="runner-header-button"
          >
            <ColorfulBlockIcon
              color={getRunnerColor()}
              size="xs"
              icon={getRunnerIcon()}
            />
            <Text fontSize="13px" fontWeight="medium" truncate>
              {runner.name}
            </Text>
            {hasMissingMappings && (
              <Tooltip
                content="Missing variable mappings - Click to configure"
                positioning={{ placement: "top" }}
                openDelay={0}
                showArrow
              >
                <Box
                  css={{
                    animation: `${pulseAnimation} 2s ease-in-out infinite`,
                  }}
                  flexShrink={0}
                  data-testid="missing-mapping-alert"
                  onClick={(e) => {
                    e.stopPropagation(); // Prevent menu from opening
                    e.preventDefault();
                    setMenuOpen(false); // Close menu if somehow open
                    onEdit?.(runner); // Open drawer directly
                  }}
                  cursor="pointer"
                  _hover={{ transform: "scale(1.2)" }}
                  transition="transform 0.15s"
                >
                  <Icon as={LuCircleAlert} color="yellow.500" boxSize={4} />
                </Box>
              </Tooltip>
            )}
            {hasUnpublishedChanges && !hasMissingMappings && (
              <Tooltip
                content="Unpublished modifications"
                positioning={{ placement: "top" }}
                openDelay={0}
                showArrow
              >
                <Circle
                  size="8px"
                  bg="orange.400"
                  flexShrink={0}
                  data-testid="unpublished-indicator"
                />
              </Tooltip>
            )}
            <Icon
              as={LuChevronDown}
              width={2.5}
              height={2.5}
              visibility="hidden"
              _groupHover={{ visibility: "visible" }}
            />
          </Button>
        </Menu.Trigger>
        <Menu.Content minWidth="200px">
          <Menu.Item value="edit" onClick={() => onEdit?.(runner)}>
            <HStack gap={2}>
              <LuPencil size={14} />
              <Text>{editLabel}</Text>
            </HStack>
          </Menu.Item>
          <Box borderTopWidth="1px" borderColor="gray.200" my={1} />
          <Menu.Item value="remove" onClick={() => onRemove?.(runner.id)}>
            <HStack gap={2} color="red.600">
              <LuTrash2 size={14} />
              <Text>Remove from Workbench</Text>
            </HStack>
          </Menu.Item>
        </Menu.Content>
      </Menu.Root>

      <Spacer />

      {/* Play button on far right */}
      <Tooltip
        content={hasMissingMappings ? "Configure missing mappings first" : "Run evaluation"}
        positioning={{ placement: "top" }}
        openDelay={200}
      >
        <IconButton
          aria-label="Run evaluation for this runner"
          size="xs"
          variant="ghost"
          onClick={(e) => {
            e.stopPropagation();
            // If there are missing mappings, open the drawer instead of running
            if (hasMissingMappings) {
              onEdit?.(runner);
            } else {
              onRun?.(runner);
            }
          }}
          data-testid="runner-play-button"
          minWidth="auto"
          height="auto"
          padding={1}
        >
          <LuPlay size={14} />
        </IconButton>
      </Tooltip>
    </HStack>
  );
});
