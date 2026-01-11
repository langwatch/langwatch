import { Box, Button, Circle, HStack, Icon, IconButton, Spacer, Text } from "@chakra-ui/react";
import { keyframes } from "@emotion/react";
import { memo, useMemo, useState } from "react";
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
import { VersionBadge } from "~/prompts/components/ui/VersionBadge";
import { useLatestPromptVersion } from "~/prompts/hooks/useLatestPromptVersion";
import { useEvaluationsV3Store } from "../../hooks/useEvaluationsV3Store";
import type { TargetConfig } from "../../types";
import { targetHasMissingMappings } from "../../utils/mappingValidation";
import { computeTargetAggregates } from "../../utils/computeAggregates";
import { isRowEmpty } from "../../utils/emptyRowDetection";
import { transposeColumnsFirstToRowsFirstWithId } from "~/optimization_studio/utils/datasetUtils";
import { TargetSummary } from "./TargetSummary";

// Pulsing animation for missing mapping alert
const pulseAnimation = keyframes`
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.2); }
`;

type TargetHeaderProps = {
  target: TargetConfig;
  onEdit?: (target: TargetConfig) => void;
  onRemove?: (targetId: string) => void;
  onRun?: (target: TargetConfig) => void;
};

/**
 * Header component for target columns in the evaluations table.
 * Shows target name with icon, a play button, and a dropdown menu on click.
 *
 * Menu options:
 * - For prompts: "Edit Prompt", "Remove from Workbench"
 * - For agents: "Edit Agent", "Remove from Workbench"
 *
 * Note: For workflow agents, clicking "Edit Agent" opens the workflow in a new tab.
 * This is determined at runtime by fetching the agent data via tRPC.
 *
 * Memoized to prevent unnecessary re-renders when other targets' config changes.
 */
export const TargetHeader = memo(function TargetHeader({
  target,
  onEdit,
  onRemove,
  onRun,
}: TargetHeaderProps) {
  // First check if prop has localPromptConfig (for direct prop usage)
  const propHasUnpublished =
    target.type === "prompt" && !!target.localPromptConfig;

  // Subscribe directly to just this target's unpublished state from store
  // This is used when the table passes targets without localPromptConfig in props
  // (e.g., when using useShallow which doesn't deep-compare)
  const storeHasUnpublished = useEvaluationsV3Store((state) => {
    if (target.type !== "prompt") return false;
    const currentTarget = state.targets.find((r) => r.id === target.id);
    return (
      currentTarget?.type === "prompt" && !!currentTarget.localPromptConfig
    );
  });

  // Use prop value if available, otherwise use store value
  const hasUnpublishedChanges = propHasUnpublished || storeHasUnpublished;

  // Check if there are missing mappings for the active dataset
  const activeDatasetId = useEvaluationsV3Store((state) => state.activeDatasetId);
  const hasMissingMappings = targetHasMissingMappings(target, activeDatasetId);

  // Get results, evaluators, and dataset for computing aggregates
  const { results, evaluators, activeDataset } = useEvaluationsV3Store((state) => ({
    results: state.results,
    evaluators: state.evaluators,
    activeDataset: state.datasets.find((d) => d.id === state.activeDatasetId),
  }));

  // Count non-empty rows (empty rows are skipped during execution)
  const nonEmptyRowCount = useMemo(() => {
    if (!activeDataset?.inline?.records) return 0;
    const rows = transposeColumnsFirstToRowsFirstWithId(activeDataset.inline.records);
    return rows.filter((row: Record<string, unknown>) => !isRowEmpty(row)).length;
  }, [activeDataset?.inline?.records]);

  // Compute aggregate statistics using non-empty row count
  const aggregates = useMemo(
    () => computeTargetAggregates(target.id, results, evaluators, nonEmptyRowCount),
    [target.id, results, evaluators, nonEmptyRowCount]
  );

  // Show aggregates only when we have results or errors or running
  const hasAggregates = 
    aggregates.completedRows > 0 || 
    aggregates.errorRows > 0 ||
    aggregates.totalCost !== null ||
    results.status === "running";

  // Get the latest version for this prompt (to determine if target is at "latest")
  const { latestVersion } = useLatestPromptVersion({
    configId: target.type === "prompt" ? target.promptId : undefined,
    currentVersion: target.type === "prompt" ? target.promptVersionNumber : undefined,
  });

  // Check if this target is effectively at "latest" version
  // (either has no pinned version, or pinned version matches latest)
  const isAtLatestVersion =
    target.type === "prompt" &&
    (target.promptVersionNumber === undefined ||
      target.promptVersionNumber === latestVersion);

  // Show version badge if:
  // - Has version number defined AND is NOT at latest version
  // Simple rule: if you're pinned to an older version, show the version badge (gray, no upgrade arrow)
  // This helps users see they're working with an older version at a glance
  // Note: We intentionally don't show drift/upgrade on the table. Users pin old versions
  // for comparison. Drift detection is handled in the drawer.
  const showVersionBadge =
    target.type === "prompt" &&
    target.promptVersionNumber !== undefined &&
    !isAtLatestVersion;

  // Controlled menu state to prevent closing on re-renders
  const [menuOpen, setMenuOpen] = useState(false);

  // Determine icon based on target type
  const getTargetIcon = () => {
    if (target.type === "prompt") {
      return <LuFileText size={12} />;
    }
    return <LuCode size={12} />;
  };

  const getTargetColor = () => {
    return target.type === "prompt" ? "green.400" : "#3E5A60";
  };

  const editLabel = target.type === "prompt" ? "Edit Prompt" : "Edit Agent";

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
            data-testid="target-header-button"
          >
            <ColorfulBlockIcon
              color={getTargetColor()}
              size="xs"
              icon={getTargetIcon()}
            />
            <Text fontSize="13px" fontWeight="medium" truncate>
              {target.name}
            </Text>
            {showVersionBadge && target.promptVersionNumber !== undefined && (
              <Box flexShrink={0}>
                <VersionBadge
                  version={target.promptVersionNumber}
                />
              </Box>
            )}
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
                    onEdit?.(target); // Open drawer directly
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
          <Menu.Item value="edit" onClick={() => onEdit?.(target)}>
            <HStack gap={2}>
              <LuPencil size={14} />
              <Text>{editLabel}</Text>
            </HStack>
          </Menu.Item>
          <Box borderTopWidth="1px" borderColor="gray.200" my={1} />
          <Menu.Item value="remove" onClick={() => onRemove?.(target.id)}>
            <HStack gap={2} color="red.600">
              <LuTrash2 size={14} />
              <Text>Remove from Workbench</Text>
            </HStack>
          </Menu.Item>
        </Menu.Content>
      </Menu.Root>

      <Spacer />

      {/* Summary statistics (positioned on the right before play button) */}
      {hasAggregates && (
        <TargetSummary
          aggregates={aggregates}
          isRunning={results.status === "running"}
        />
      )}

      {/* Play button on far right */}
        <Tooltip
          content={hasMissingMappings ? "Configure missing mappings first" : "Run evaluation"}
          positioning={{ placement: "top" }}
          openDelay={200}
        >
          <IconButton
            aria-label="Run evaluation for this target"
            size="xs"
            variant="ghost"
            onClick={(e) => {
              e.stopPropagation();
              // If there are missing mappings, open the drawer instead of running
              if (hasMissingMappings) {
                onEdit?.(target);
              } else {
                onRun?.(target);
              }
            }}
            data-testid="target-play-button"
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
